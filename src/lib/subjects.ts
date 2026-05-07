export const SUBJECTS = [
  "Internal Medicine",
  "Pediatric",
  "OB/GYNE",
  "Surgery",
  "Emergency Medicine",
  "Orthopedic",
  "Otolaryngology",
  "Opthalmology",
  "Forensic",
  "Anesthesiology",
  "Family Medicine/Community Medicine",
] as const;

export type SubjectName = (typeof SUBJECTS)[number];
