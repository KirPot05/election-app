import type { Metadata } from "next";
import { ButtonLink, Card, PageTitle } from "@/components/ui";
import { getDb } from "@/server/db";
import { getAdminDashboard } from "@/server/services/results";
import { LiveDashboard } from "./live-dashboard";

export const metadata: Metadata = { title: "Admin overview" };

export default async function AdminOverviewPage() {
  const dashboard = await getAdminDashboard(getDb());
  if (!dashboard.election) {
    return (
      <Card>
        <PageTitle sub="No election exists yet.">Set up the election</PageTitle>
        <ButtonLink href="/admin/election" className="w-full">
          Create the election
        </ButtonLink>
      </Card>
    );
  }
  return <LiveDashboard initial={dashboard} />;
}
