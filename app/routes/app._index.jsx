// app/routes/app._index.jsx — GWP Dashboard
import { useLoaderData, useFetcher, useRouteError } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { getCampaigns, deleteCampaign } from "../models/campaign.server";
import { deleteAutomaticDiscount } from "../models/shopify-operations.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const campaigns = await getCampaigns(session.shop);
  return { campaigns };
};

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const actionType = formData.get("actionType");

  if (actionType === "delete") {
    const id = formData.get("id");
    const discountId = formData.get("discountId");

    // Delete Shopify discount if exists
    if (discountId) {
      try {
        await deleteAutomaticDiscount(admin, discountId);
      } catch (e) {
        console.error("Failed to delete Shopify discount:", e);
      }
    }
    await deleteCampaign(id, session.shop);
    return { success: true };
  }

  return null;
};

function formatDate(dateStr) {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function StatusBadge({ status }) {
  const map = {
    active: "success",
    draft: "warning",
    paused: "attention",
    ended: "critical",
  };
  const tone = map[status] || "info";
  return <s-badge tone={tone}>{status}</s-badge>;
}

export default function Dashboard() {
  const { campaigns } = useLoaderData();
  const fetcher = useFetcher();

  function handleDelete(campaign) {
    if (!confirm(`Delete campaign "${campaign.title}"? This cannot be undone.`)) return;
    const fd = new FormData();
    fd.append("actionType", "delete");
    fd.append("id", campaign.id);
    if (campaign.discountId) fd.append("discountId", campaign.discountId);
    fetcher.submit(fd, { method: "POST" });
  }

  if (campaigns.length === 0) {
    return (
      <s-page heading="GWP Campaigns">
        <s-button slot="primary-action" href="/app/campaign/new" variant="primary">
          Create Campaign
        </s-button>
        <s-section>
          <s-stack direction="block" gap="loose" alignment="center">
            <s-icon source="gift" />
            <s-heading>No campaigns yet</s-heading>
            <s-paragraph>Create your first Gift With Purchase campaign to reward customers!</s-paragraph>
            <s-button href="/app/campaign/new" variant="primary">Create Your First Campaign</s-button>
          </s-stack>
        </s-section>
      </s-page>
    );
  }

  return (
    <s-page heading="GWP Campaigns">
      <s-button slot="primary-action" href="/app/campaign/new" variant="primary">
        Create Campaign
      </s-button>

      <s-section>
        <s-index-table resource-name-singular="campaign" resource-name-plural="campaigns" item-count={campaigns.length}>
          <s-index-table-row slot="headings">
            <s-index-table-cell>Title</s-index-table-cell>
            <s-index-table-cell>Status</s-index-table-cell>
            <s-index-table-cell>Start</s-index-table-cell>
            <s-index-table-cell>End</s-index-table-cell>
            <s-index-table-cell>Tiers</s-index-table-cell>
            <s-index-table-cell>Gifts</s-index-table-cell>
            <s-index-table-cell>Users</s-index-table-cell>
            <s-index-table-cell>Actions</s-index-table-cell>
          </s-index-table-row>

          {campaigns.map((c) => {
            const tiers = (() => { try { return JSON.parse(c.tiers); } catch { return []; } })();
            return (
              <s-index-table-row key={c.id} id={c.id}>
                <s-index-table-cell>
                  <s-link href={`/app/campaign/${c.id}`}>{c.title}</s-link>
                </s-index-table-cell>
                <s-index-table-cell>
                  <StatusBadge status={c.status} />
                </s-index-table-cell>
                <s-index-table-cell>{formatDate(c.startTime)}</s-index-table-cell>
                <s-index-table-cell>{formatDate(c.endTime)}</s-index-table-cell>
                <s-index-table-cell>{tiers.length}</s-index-table-cell>
                <s-index-table-cell>{c._count?.gifts ?? 0}</s-index-table-cell>
                <s-index-table-cell>{c._count?.eligibleUsers ?? 0}</s-index-table-cell>
                <s-index-table-cell>
                  <s-stack direction="inline" gap="tight">
                    <s-button href={`/app/campaign/${c.id}`} size="slim">Edit</s-button>
                    <s-button
                      size="slim"
                      tone="critical"
                      onClick={() => handleDelete(c)}
                    >
                      Delete
                    </s-button>
                  </s-stack>
                </s-index-table-cell>
              </s-index-table-row>
            );
          })}
        </s-index-table>
      </s-section>
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
