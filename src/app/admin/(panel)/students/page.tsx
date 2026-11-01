import type { Metadata } from "next";
import { PageTitle } from "@/components/ui";
import { getDb } from "@/server/db";
import { getElection } from "@/server/services/election";
import { listStudents } from "@/server/services/students";
import { StudentManager } from "./student-manager";

export const metadata: Metadata = { title: "Students" };

export default async function StudentsPage() {
  const db = getDb();
  const [election, students] = await Promise.all([getElection(db), listStudents(db)]);
  return (
    <>
      <PageTitle sub="Registered students and who has voted. Ballot choices are never shown.">Students</PageTitle>
      <StudentManager initial={students} eligibilityEditable={!election || election.status === "DRAFT"} />
    </>
  );
}
