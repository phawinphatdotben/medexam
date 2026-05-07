import Link from "next/link";

export default function CreateTestHubPage() {
  return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center px-4 pt-20 pb-12">
      <h1 className="text-3xl font-bold text-blue-900 mb-2">Create a test</h1>
      <p className="text-gray-600 mb-10 text-center max-w-md">
        Choose the format. New items stay in the pool as pending until committee approval. Approved practice
        tests are open to students for self-study; approved real tests are delivered only via Test assignments
        (admin / sub-admin) into each student&apos;s Test session.
      </p>
      <div className="flex flex-col sm:flex-row gap-4 w-full max-w-lg">
        <Link
          href="/dashboard/create-sba"
          className="flex-1 text-center bg-teal-600 text-white font-semibold py-4 rounded-xl shadow hover:bg-teal-700 transition"
        >
          SBA (single best answer)
        </Link>
        <Link
          href="/dashboard/create-meq"
          className="flex-1 text-center bg-blue-700 text-white font-semibold py-4 rounded-xl shadow hover:bg-blue-800 transition"
        >
          MEQ (staged, typed answers)
        </Link>
      </div>
      <div className="mt-8">
        <Link href="/dashboard" className="text-blue-600 hover:underline text-sm">
          Back to staff dashboard
        </Link>
      </div>
    </div>
  );
}
