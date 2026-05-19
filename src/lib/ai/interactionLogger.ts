"use client";

import { supabase } from "@/lib/supabase";
import type { ExamInteractionEventType } from "@/lib/ai/types";

export type InteractionLogContext = {
  meqTestId: string;
  assignmentId?: string | null;
  meqStageId?: string | null;
  meqStageItemId?: string | null;
};

/**
 * High-throughput path for student exam telemetry (RPC validates access).
 * Failures are non-blocking so exams never break if migration 045 is pending.
 */
export async function appendMeqExamInteraction(
  ctx: InteractionLogContext,
  eventType: ExamInteractionEventType,
  payload: Record<string, unknown> = {},
  clientSequence = 0,
): Promise<{ ok: boolean; id?: string; error?: string }> {
  const { data, error } = await supabase.rpc("meq_append_exam_interaction", {
    p_meq_test_id: ctx.meqTestId,
    p_event_type: eventType,
    p_meq_stage_id: ctx.meqStageId ?? null,
    p_meq_stage_item_id: ctx.meqStageItemId ?? null,
    p_assignment_id: ctx.assignmentId ?? null,
    p_client_sequence: clientSequence,
    p_payload: payload,
    p_occurred_at: new Date().toISOString(),
  });

  if (error) {
    if (error.message.includes("does not exist") || error.code === "42883") {
      return { ok: false, error: "migration_045_required" };
    }
    return { ok: false, error: error.message };
  }

  return { ok: true, id: data as string };
}

/** In-memory sequence counter per exam session (per browser tab). */
export function createInteractionSequence(): () => number {
  let n = 0;
  return () => {
    n += 1;
    return n;
  };
}
