import { supabase } from "@/lib/supabase";
import type {
  AssessmentPhase,
  FormativeCorpusExport,
  MeqAiPipelineConfig,
  MeqMlStudentVector,
  ProcessSyncQueueResult,
  RefreshVectorsResult,
} from "@/lib/ai/types";

export type PipelineServiceError = {
  code: "migration_required" | "forbidden" | "unknown";
  message: string;
};

function mapRpcError(error: { message: string; code?: string }): PipelineServiceError {
  if (error.message.includes("does not exist") || error.code === "42883" || error.code === "42P01") {
    return { code: "migration_required", message: "Apply Supabase migration 045_ai_data_pipeline.sql" };
  }
  if (error.message.includes("required") || error.code === "42501") {
    return { code: "forbidden", message: error.message };
  }
  return { code: "unknown", message: error.message };
}

/** Singleton pipeline flags (formative-first defaults). */
export async function fetchAiPipelineConfig(): Promise<{
  data: MeqAiPipelineConfig | null;
  error: PipelineServiceError | null;
}> {
  const { data, error } = await supabase
    .from("meq_ai_pipeline_config")
    .select("id, formative_capture_enabled, summative_capture_enabled, auto_enqueue_on_lock, updated_at, updated_by")
    .eq("id", 1)
    .maybeSingle();

  if (error) return { data: null, error: mapRpcError(error) };
  return { data: data as MeqAiPipelineConfig, error: null };
}

/** Admin: toggle formative capture / auto-enqueue. */
export async function updateAiPipelineConfig(patch: {
  formative_capture_enabled?: boolean;
  summative_capture_enabled?: boolean;
  auto_enqueue_on_lock?: boolean;
}): Promise<{ error: PipelineServiceError | null }> {
  const { error } = await supabase
    .from("meq_ai_pipeline_config")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", 1);

  if (error) return { error: mapRpcError(error) };
  return { error: null };
}

/** Force-sync one locked response into `meq_ai_training_records`. */
export async function syncTrainingRecordFromResponse(
  responseId: string,
): Promise<{ trainingRecordId: string | null; error: PipelineServiceError | null }> {
  const { data, error } = await supabase.rpc("meq_sync_training_record_from_response", {
    p_response_id: responseId,
  });

  if (error) return { trainingRecordId: null, error: mapRpcError(error) };
  return { trainingRecordId: (data as string | null) ?? null, error: null };
}

/** Process pending rows in `meq_ai_sync_queue` (admin / scheduled job). */
export async function processAiSyncQueue(
  limit = 100,
): Promise<{ result: ProcessSyncQueueResult | null; error: PipelineServiceError | null }> {
  const { data, error } = await supabase.rpc("meq_process_ai_sync_queue", { p_limit: limit });

  if (error) return { result: null, error: mapRpcError(error) };
  return { result: data as ProcessSyncQueueResult, error: null };
}

/**
 * Rebuild `meq_ml_student_vectors` from training records.
 * Default phase = formative for the research formative assessment track.
 */
export async function refreshMlStudentVectors(options?: {
  assessmentPhase?: AssessmentPhase;
  subject?: string | null;
  courseCode?: string | null;
}): Promise<{ result: RefreshVectorsResult | null; error: PipelineServiceError | null }> {
  const { data, error } = await supabase.rpc("meq_refresh_ml_student_vectors", {
    p_assessment_phase: options?.assessmentPhase ?? "formative",
    p_subject: options?.subject ?? null,
    p_course_code: options?.courseCode ?? null,
  });

  if (error) return { result: null, error: mapRpcError(error) };
  return { result: data as RefreshVectorsResult, error: null };
}

/** Export parallel arrays for downstream ML / recommendation prototypes. */
export async function exportFormativeCorpusArrays(options?: {
  courseCode?: string | null;
  taskCategory?: string | null;
  limit?: number;
}): Promise<{ corpus: FormativeCorpusExport | null; error: PipelineServiceError | null }> {
  const { data, error } = await supabase.rpc("meq_export_formative_corpus_arrays", {
    p_course_code: options?.courseCode ?? null,
    p_task_category: options?.taskCategory ?? null,
    p_limit: options?.limit ?? 5000,
  });

  if (error) return { corpus: null, error: mapRpcError(error) };
  return { corpus: data as FormativeCorpusExport, error: null };
}

/** Direct read of clustered vectors (staff RLS). */
export async function listMlStudentVectors(filters?: {
  assessmentPhase?: AssessmentPhase;
  courseCode?: string;
  taskCategory?: string;
  limit?: number;
}): Promise<{ rows: MeqMlStudentVector[]; error: PipelineServiceError | null }> {
  let q = supabase
    .from("meq_ml_student_vectors")
    .select("*")
    .order("refreshed_at", { ascending: false })
    .limit(filters?.limit ?? 500);

  if (filters?.assessmentPhase) {
    q = q.eq("assessment_phase", filters.assessmentPhase);
  }
  if (filters?.courseCode) {
    q = q.eq("course_code", filters.courseCode);
  }
  if (filters?.taskCategory) {
    q = q.eq("task_category", filters.taskCategory);
  }

  const { data, error } = await q;
  if (error) return { rows: [], error: mapRpcError(error) };
  return { rows: (data ?? []) as MeqMlStudentVector[], error: null };
}

/** End-to-end formative refresh: drain queue → rebuild vectors → export snapshot. */
export async function runFormativePipelineBatch(options?: {
  queueLimit?: number;
  courseCode?: string | null;
  exportLimit?: number;
}): Promise<{
  queue: ProcessSyncQueueResult | null;
  refresh: RefreshVectorsResult | null;
  corpus: FormativeCorpusExport | null;
  error: PipelineServiceError | null;
}> {
  const q = await processAiSyncQueue(options?.queueLimit ?? 200);
  if (q.error) return { queue: null, refresh: null, corpus: null, error: q.error };

  const r = await refreshMlStudentVectors({
    assessmentPhase: "formative",
    courseCode: options?.courseCode ?? null,
  });
  if (r.error) return { queue: q.result, refresh: null, corpus: null, error: r.error };

  const e = await exportFormativeCorpusArrays({
    courseCode: options?.courseCode ?? null,
    limit: options?.exportLimit ?? 5000,
  });
  if (e.error) return { queue: q.result, refresh: r.result, corpus: null, error: e.error };

  return { queue: q.result, refresh: r.result, corpus: e.corpus, error: null };
}
