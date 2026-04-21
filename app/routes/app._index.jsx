import { useLoaderData, useFetcher } from "react-router";
import {
  Page,
  Layout,
  Card,
  IndexTable,
  Button,
  Text,
  Badge,
  InlineStack,
  BlockStack,
  EmptyState,
  ButtonGroup,
} from "@shopify/polaris";
import { PlusIcon, DeleteIcon, EditIcon } from "@shopify/polaris-icons";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  
  // 动态导入后端模型
  const { getCampaigns } = await import("../models/campaign.server");
  const campaigns = await getCampaigns(session.shop);
  
  // Calculate stats
  const activeCount = campaigns.filter(c => c.status === "active").length;
  const totalGiftsSent = campaigns.reduce((acc, c) => acc + (c._count?.gifts || 0), 0);
  
  return { campaigns, stats: { activeCount, totalGiftsSent } };
};

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const actionType = formData.get("actionType");

  if (actionType === "delete") {
    const id = formData.get("id");
    const discountId = formData.get("discountId");

    // 动态导入后端操作
    const { deleteCampaign } = await import("../models/campaign.server");
    const { deleteAutomaticDiscount } = await import("../models/shopify-operations.server");

    if (discountId) {
      try { await deleteAutomaticDiscount(admin, discountId); } catch (e) { console.error(e); }
    }
    await deleteCampaign(id, session.shop);
    return { success: true, message: "Campaign deleted." };
  }
  return null;
};

export default function Dashboard() {
  const { campaigns, stats } = useLoaderData();
  const fetcher = useFetcher();

  const resourceName = { singular: "campaign", plural: "campaigns" };

  if (campaigns.length === 0) {
    return (
      <Page title="GWP Campaigns" primaryAction={{ content: "Create Campaign", url: "/app/campaign/new", icon: PlusIcon }}>
        <EmptyState
          heading="Create your first GWP campaign"
          action={{ content: "Create Campaign", url: "/app/campaign/new" }}
          image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
        >
          <p>Reward your customers with free gifts based on their spend tiers.</p>
        </EmptyState>
      </Page>
    );
  }

  return (
    <Page title="GWP Dashboard" primaryAction={{ content: "Create Campaign", url: "/app/campaign/new", icon: PlusIcon }}>
      <Layout>
        <Layout.Section>
          <InlineStack gap="400">
            <div style={{ flex: 1 }}>
              <Card>
                <BlockStack gap="100">
                  <Text variant="headingSm">Active Campaigns</Text>
                  <Text variant="headingLg" as="p">{stats.activeCount}</Text>
                </BlockStack>
              </Card>
            </div>
            <div style={{ flex: 1 }}>
              <Card>
                <BlockStack gap="100">
                  <Text variant="headingSm">Total Gifts Configured</Text>
                  <Text variant="headingLg" as="p">{stats.totalGiftsSent}</Text>
                </BlockStack>
              </Card>
            </div>
          </InlineStack>
        </Layout.Section>

        <Layout.Section>
          <Card padding="0">
            <IndexTable
              resourceName={resourceName}
              itemCount={campaigns.length}
              headings={[
                { title: "Campaign" },
                { title: "Status" },
                { title: "Start" },
                { title: "End" },
                { title: "Tiers" },
                { title: "Actions" },
              ]}
              selectable={false}
            >
              {campaigns.map((c, index) => (
                <IndexTable.Row id={c.id} key={c.id} position={index}>
                  <IndexTable.Cell>
                    <Text variant="bodyMd" weight="bold">{c.title}</Text>
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <Badge tone={c.status === "active" ? "success" : "attention"}>{c.status}</Badge>
                  </IndexTable.Cell>
                  <IndexTable.Cell>{new Date(c.startTime).toLocaleDateString()}</IndexTable.Cell>
                  <IndexTable.Cell>{new Date(c.endTime).toLocaleDateString()}</IndexTable.Cell>
                  <IndexTable.Cell>{JSON.parse(c.tiers || "[]").length} Tiers</IndexTable.Cell>
                  <IndexTable.Cell>
                    <ButtonGroup>
                      <Button size="slim" icon={EditIcon} url={`/app/campaign/${c.id}`}>Edit</Button>
                      <Button size="slim" icon={DeleteIcon} tone="destructive" onClick={() => {
                        if(confirm("Delete?")) {
                          const fd = new FormData();
                          fd.append("actionType", "delete");
                          fd.append("id", c.id);
                          if(c.discountId) fd.append("discountId", c.discountId);
                          fetcher.submit(fd, { method: "POST" });
                        }
                      }}>Delete</Button>
                    </ButtonGroup>
                  </IndexTable.Cell>
                </IndexTable.Row>
              ))}
            </IndexTable>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
