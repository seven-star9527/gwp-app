// app/routes/app.campaign.$id.jsx — Create / Edit Campaign (Polished Polaris Version)
import { useState } from "react";
import {
  useLoaderData,
  useFetcher,
  useRouteError,
  redirect,
} from "react-router";
import {
  Page,
  Layout,
  Card,
  Tabs,
  TextField,
  Button,
  DataTable,
  Banner,
  Select,
  Checkbox,
  Text,
  ButtonGroup,
  Box,
  Thumbnail,
  InlineStack,
  BlockStack,
  Divider,
  Icon,
} from "@shopify/polaris";
import { SearchIcon, DeleteIcon, PlusIcon, ImportIcon } from "@shopify/polaris-icons";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import {
  getCampaign,
  createCampaign,
  updateCampaign,
  addGifts,
  deleteGift,
  addEligibleUsers,
  deleteEligibleUser,
  clearEligibleUsers,
  getDefaultStyling,
  getDefaultCopywriting,
  getDefaultTiers,
} from "../models/campaign.server";
import {
  getDiscountFunctionId,
  createAutomaticDiscount,
  updateAutomaticDiscount,
  addProductTag,
  addCustomerTag,
  findCustomerByEmail,
  searchProducts,
} from "../models/shopify-operations.server";

// ─── Loader ──────────────────────────────────────────────────────────────────
export const loader = async ({ request, params }) => {
  const { session } = await authenticate.admin(request);
  const { id } = params;

  if (id === "new") {
    return {
      campaign: null,
      tiers: getDefaultTiers(),
      styling: getDefaultStyling(),
      copywriting: getDefaultCopywriting(),
      gifts: [],
      eligibleUsers: [],
      isNew: true,
    };
  }

  const campaign = await getCampaign(id, session.shop);
  if (!campaign) throw new Response("Campaign not found", { status: 404 });

  return {
    campaign,
    tiers: JSON.parse(campaign.tiers || "[]"),
    styling: JSON.parse(campaign.styling || "{}"),
    copywriting: JSON.parse(campaign.copywriting || "{}"),
    gifts: campaign.gifts || [],
    eligibleUsers: campaign.eligibleUsers || [],
    isNew: false,
  };
};

// ─── Action ──────────────────────────────────────────────────────────────────
export const action = async ({ request, params }) => {
  const { admin, session } = await authenticate.admin(request);
  const { id } = params;
  const formData = await request.formData();
  const actionType = formData.get("actionType");

  switch (actionType) {
    case "saveCampaign": {
      const data = {
        shop: session.shop,
        title: formData.get("title"),
        status: formData.get("status") || "draft",
        startTime: new Date(formData.get("startTime")),
        endTime: new Date(formData.get("endTime")),
        requireEligibility: formData.get("requireEligibility") === "true",
        giftTag: formData.get("giftTag") || "is_free_gift",
        discountMessage: formData.get("discountMessage") || "Free Gift",
        tiers: JSON.parse(formData.get("tiers") || "[]"),
        styling: JSON.parse(formData.get("styling") || "{}"),
        copywriting: JSON.parse(formData.get("copywriting") || "{}"),
      };

      if (id === "new") {
        const campaign = await createCampaign(data);
        return redirect(`/app/campaign/${campaign.id}`);
      } else {
        await updateCampaign(id, session.shop, data);
        return { success: true, message: "Campaign saved!" };
      }
    }

    case "activate": {
      const campaign = await getCampaign(id, session.shop);
      if (!campaign) throw new Response("Not found", { status: 404 });
      const functionId = await getDiscountFunctionId(admin);
      if (!functionId) return { error: "Discount function not found." };

      let discountId = campaign.discountId;
      if (!discountId) {
        const result = await createAutomaticDiscount(admin, campaign, functionId);
        discountId = result?.discountId;
      } else {
        await updateAutomaticDiscount(admin, campaign);
      }

      await updateCampaign(id, session.shop, { status: "active", discountId });
      return { success: true, message: "Campaign activated!" };
    }

    case "deactivate": {
      await updateCampaign(id, session.shop, { status: "paused" });
      return { success: true, message: "Campaign paused." };
    }

    case "searchProducts": {
      const query = formData.get("query") || "";
      const products = await searchProducts(admin, query);
      return { products };
    }

    case "addGifts": {
      const gifts = JSON.parse(formData.get("gifts") || "[]");
      await addGifts(id, gifts);
      return { success: true };
    }

    case "deleteGift": {
      await deleteGift(formData.get("giftId"));
      return { success: true };
    }

    case "importUsers": {
      const emails = JSON.parse(formData.get("emails") || "[]");
      await addEligibleUsers(id, emails);
      return { success: true };
    }

    case "deleteUser": {
      await deleteEligibleUser(formData.get("userId"));
      return { success: true };
    }

    case "clearUsers": {
      await clearEligibleUsers(id);
      return { success: true };
    }

    default:
      return { error: "Unknown action" };
  }
};

// ─── Component ───────────────────────────────────────────────────────────────
export default function CampaignPage() {
  const { campaign, tiers: initTiers, styling: initStyling, copywriting: initCopy, gifts, eligibleUsers, isNew } = useLoaderData();
  const fetcher = useFetcher();

  const [activeTab, setActiveTab] = useState(0);
  const [title, setTitle] = useState(campaign?.title || "New Campaign");
  const [status, setStatus] = useState(campaign?.status || "draft");
  const [startTime, setStartTime] = useState(campaign?.startTime ? new Date(campaign.startTime).toISOString().slice(0, 16) : "");
  const [endTime, setEndTime] = useState(campaign?.endTime ? new Date(campaign.endTime).toISOString().slice(0, 16) : "");
  const [requireEligibility, setRequireEligibility] = useState(campaign?.requireEligibility || false);
  const [giftTag, setGiftTag] = useState(campaign?.giftTag || "is_free_gift");
  const [discountMessage, setDiscountMessage] = useState(campaign?.discountMessage || "Free Gift 🎁");
  const [tiers, setTiers] = useState(initTiers);
  const [styling, setStyling] = useState(initStyling);
  const [copywriting, setCopywriting] = useState(initCopy);
  const [searchQuery, setSearchQuery] = useState("");
  const [userEmailInput, setUserEmailInput] = useState("");

  const isLoading = fetcher.state !== "idle";
  const lastAction = fetcher.data;

  const tabs = [
    { id: "basic", content: "Basic Info" },
    { id: "tiers", content: "Tiers" },
    { id: "gifts", content: "Gifts" },
    { id: "users", content: "Users" },
    { id: "styling", content: "Styling" },
    { id: "copy", content: "Copywriting" },
  ];

  const saveCampaign = () => {
    const fd = new FormData();
    fd.append("actionType", "saveCampaign");
    fd.append("title", title);
    fd.append("status", status);
    fd.append("startTime", startTime);
    fd.append("endTime", endTime);
    fd.append("requireEligibility", String(requireEligibility));
    fd.append("giftTag", giftTag);
    fd.append("discountMessage", discountMessage);
    fd.append("tiers", JSON.stringify(tiers));
    fd.append("styling", JSON.stringify(styling));
    fd.append("copywriting", JSON.stringify(copywriting));
    fetcher.submit(fd, { method: "POST" });
  };

  const toggleActivate = () => {
    const fd = new FormData();
    fd.append("actionType", campaign?.status === "active" ? "deactivate" : "activate");
    fetcher.submit(fd, { method: "POST" });
  };

  const handleCsvUpload = (event) => {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target.result;
      const emails = text.split(/[\n,]/).map(e => e.trim()).filter(e => e.includes("@"));
      if (emails.length > 0) {
        const fd = new FormData();
        fd.append("actionType", "importUsers");
        fd.append("emails", JSON.stringify(emails));
        fetcher.submit(fd, { method: "POST" });
      }
    };
    reader.readAsText(file);
  };

  return (
    <Page
      backAction={{ content: "Dashboard", url: "/app" }}
      title={isNew ? "New Campaign" : title}
      primaryAction={{ content: "Save Campaign", onAction: saveCampaign, loading: isLoading }}
      secondaryActions={[
        !isNew && {
          content: campaign?.status === "active" ? "Pause" : "Activate",
          onAction: toggleActivate,
          loading: isLoading,
          destructive: campaign?.status === "active",
        },
      ].filter(Boolean)}
    >
      <Layout>
        <Layout.Section>
          {lastAction?.error && <Banner tone="critical">{lastAction.error}</Banner>}
          {lastAction?.message && <Banner tone="success">{lastAction.message}</Banner>}
          
          <Card padding="0">
            <Tabs tabs={tabs} selected={activeTab} onSelect={setActiveTab} />
            <Box padding="400">
              {activeTab === 0 && (
                <BlockStack gap="400">
                  <TextField label="Campaign Title" value={title} onChange={setTitle} autoComplete="off" />
                  <Select
                    label="Status"
                    options={[
                      { label: "Draft", value: "draft" },
                      { label: "Active", value: "active" },
                      { label: "Paused", value: "paused" },
                    ]}
                    value={status}
                    onChange={setStatus}
                  />
                  <InlineStack gap="400">
                    <div style={{ flex: 1 }}>
                      <TextField label="Start Time" type="datetime-local" value={startTime} onChange={setStartTime} autoComplete="off" />
                    </div>
                    <div style={{ flex: 1 }}>
                      <TextField label="End Time" type="datetime-local" value={endTime} onChange={setEndTime} autoComplete="off" />
                    </div>
                  </InlineStack>
                  <Checkbox label="Require Eligibility" checked={requireEligibility} onChange={setRequireEligibility} />
                  <TextField label="Gift Tag" value={giftTag} onChange={setGiftTag} helpText="Tag products with this to make them gifts" autoComplete="off" />
                  <TextField label="Discount Message" value={discountMessage} onChange={setDiscountMessage} autoComplete="off" />
                </BlockStack>
              )}

              {activeTab === 1 && (
                <BlockStack gap="400">
                  <Banner tone="info">Define spend thresholds and gift allowances.</Banner>
                  {tiers.map((tier, i) => (
                    <InlineStack key={i} gap="400" align="start">
                      <div style={{ flex: 1 }}>
                        <TextField
                          label={`Tier ${i + 1} Threshold ($)`}
                          type="number"
                          prefix="$"
                          value={String(tier.threshold)}
                          onChange={(val) => {
                            const newTiers = [...tiers];
                            newTiers[i].threshold = parseFloat(val) || 0;
                            setTiers(newTiers);
                          }}
                          autoComplete="off"
                        />
                      </div>
                      <div style={{ flex: 1 }}>
                        <TextField
                          label="Allowance ($)"
                          type="number"
                          prefix="$"
                          value={String(tier.allowance)}
                          onChange={(val) => {
                            const newTiers = [...tiers];
                            newTiers[i].allowance = parseFloat(val) || 0;
                            setTiers(newTiers);
                          }}
                          autoComplete="off"
                        />
                      </div>
                      <div style={{ paddingTop: "28px" }}>
                        <Button icon={DeleteIcon} tone="destructive" onClick={() => setTiers(tiers.filter((_, idx) => idx !== i))} />
                      </div>
                    </InlineStack>
                  ))}
                  <Button icon={PlusIcon} onClick={() => setTiers([...tiers, { threshold: 0, allowance: 0 }])}>Add Tier</Button>
                </BlockStack>
              )}

              {activeTab === 2 && (
                <BlockStack gap="400">
                  <InlineStack gap="200">
                    <div style={{ flex: 1 }}>
                      <TextField
                        placeholder="Search products..."
                        value={searchQuery}
                        onChange={setSearchQuery}
                        prefix={<Icon source={SearchIcon} />}
                        autoComplete="off"
                      />
                    </div>
                    <Button onClick={() => {
                       const fd = new FormData();
                       fd.append("actionType", "searchProducts");
                       fd.append("query", searchQuery);
                       fetcher.submit(fd, { method: "POST" });
                    }} loading={isLoading}>Search</Button>
                  </InlineStack>

                  <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
                    {lastAction?.products?.map((p) => (
                      <Box key={p.id} padding="200" borderBlockEndWidth="025" borderColor="border">
                        <InlineStack gap="400" align="center">
                          <Thumbnail source={p.images?.nodes?.[0]?.url || ""} alt={p.title} size="small" />
                          <div style={{ flex: 1 }}>
                            <Text variant="bodyMd" weight="bold">{p.title}</Text>
                            <InlineStack gap="200">
                              {p.variants?.nodes?.map((v) => (
                                <Button key={v.id} size="slim" onClick={() => {
                                  const fd = new FormData();
                                  fd.append("actionType", "addGifts");
                                  fd.append("gifts", JSON.stringify([{
                                    productId: p.id,
                                    variantId: v.id,
                                    title: p.title,
                                    variantTitle: v.title !== "Default Title" ? v.title : "",
                                    price: v.price,
                                    imageUrl: p.images?.nodes?.[0]?.url || "",
                                    handle: p.handle,
                                  }]));
                                  fetcher.submit(fd, { method: "POST" });
                                }}>+ {v.title} (${v.price})</Button>
                              ))}
                            </InlineStack>
                          </div>
                        </InlineStack>
                      </Box>
                    ))}
                  </div>

                  <Divider />
                  <Text variant="headingMd">Active Gifts</Text>
                  {gifts.length > 0 ? (
                    <DataTable
                      columnContentTypes={["text", "text", "numeric", "numeric", "text"]}
                      headings={["Product", "Variant", "Price", "Sent", "Action"]}
                      rows={gifts.map((g) => [
                        g.title,
                        g.variantTitle || "—",
                        `$${g.price}`,
                        g.inventoryUsed,
                        <Button icon={DeleteIcon} tone="destructive" size="slim" onClick={() => {
                          const fd = new FormData();
                          fd.append("actionType", "deleteGift");
                          fd.append("giftId", g.id);
                          fetcher.submit(fd, { method: "POST" });
                        }} />,
                      ])}
                    />
                  ) : (
                    <Banner tone="info">No gifts added yet.</Banner>
                  )}
                </BlockStack>
              )}

              {activeTab === 3 && (
                <BlockStack gap="400">
                  <InlineStack gap="400">
                    <div style={{ flex: 1 }}>
                      <TextField
                        label="Paste Emails"
                        multiline={3}
                        value={userEmailInput}
                        onChange={setUserEmailInput}
                        autoComplete="off"
                      />
                    </div>
                    <div style={{ paddingTop: '24px' }}>
                      <Button icon={ImportIcon} onClick={() => document.getElementById('csv-upload').click()}>CSV File</Button>
                      <input type="file" id="csv-upload" accept=".csv" style={{ display: 'none' }} onChange={handleCsvUpload} />
                    </div>
                  </InlineStack>
                  <ButtonGroup>
                    <Button variant="primary" onClick={() => {
                       const fd = new FormData();
                       fd.append("actionType", "importUsers");
                       fd.append("emails", JSON.stringify(userEmailInput.split("\n").filter(Boolean)));
                       fetcher.submit(fd, { method: "POST" });
                       setUserEmailInput("");
                    }}>Import Pasted</Button>
                    <Button tone="destructive" onClick={() => {
                       const fd = new FormData();
                       fd.append("actionType", "clearUsers");
                       fetcher.submit(fd, { method: "POST" });
                    }}>Clear All</Button>
                  </ButtonGroup>
                  <DataTable
                    columnContentTypes={["text", "text"]}
                    headings={["Email", "Action"]}
                    rows={eligibleUsers.map(u => [
                      u.email,
                      <Button icon={DeleteIcon} tone="destructive" size="slim" onClick={() => {
                        const fd = new FormData();
                        fd.append("actionType", "deleteUser");
                        fd.append("userId", u.id);
                        fetcher.submit(fd, { method: "POST" });
                      }} />
                    ])}
                  />
                </BlockStack>
              )}

              {activeTab === 4 && (
                <BlockStack gap="400">
                  {Object.keys(styling).map(key => (
                    <InlineStack key={key} gap="400" align="center">
                      <div style={{ flex: 1 }}>
                        <TextField
                          label={key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase())}
                          value={styling[key]}
                          onChange={(val) => setStyling({ ...styling, [key]: val })}
                          autoComplete="off"
                        />
                      </div>
                      {key.toLowerCase().includes('color') && (
                        <div style={{ paddingTop: '24px' }}>
                          <input type="color" value={styling[key].startsWith('#') ? styling[key] : '#000000'} onChange={(e) => setStyling({ ...styling, [key]: e.target.value })} style={{ width: '40px', height: '40px' }} />
                        </div>
                      )}
                    </InlineStack>
                  ))}
                </BlockStack>
              )}

              {activeTab === 5 && (
                <BlockStack gap="400">
                  {Object.keys(copywriting).map(key => (
                    <TextField
                      key={key}
                      label={key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase())}
                      value={copywriting[key]}
                      onChange={(val) => setCopywriting({ ...copywriting, [key]: val })}
                      autoComplete="off"
                    />
                  ))}
                </BlockStack>
              )}
            </Box>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
