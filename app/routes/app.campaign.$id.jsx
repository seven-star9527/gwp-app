// app/routes/app.campaign.$id.jsx — Create / Edit Campaign
import { useState, useCallback } from "react";
import {
  useLoaderData,
  useFetcher,
  useNavigate,
  useRouteError,
  redirect,
} from "react-router";
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
      if (!functionId) {
        return { error: "GWP discount function not found. Deploy extensions first." };
      }

      let discountId = campaign.discountId;
      if (!discountId) {
        const result = await createAutomaticDiscount(admin, campaign, functionId);
        discountId = result?.discountId;
      } else {
        await updateAutomaticDiscount(admin, campaign);
      }

      // Tag gift products
      for (const gift of campaign.gifts) {
        await addProductTag(admin, gift.productId, campaign.giftTag || "is_free_gift");
      }

      // Tag eligible users (if requireEligibility)
      if (campaign.requireEligibility) {
        for (const user of campaign.eligibleUsers) {
          if (user.customerId) {
            await addCustomerTag(admin, user.customerId, "gwp_eligible");
          } else {
            const customer = await findCustomerByEmail(admin, user.email);
            if (customer) {
              await addCustomerTag(admin, customer.id, "gwp_eligible");
            }
          }
        }
      }

      await updateCampaign(id, session.shop, {
        status: "active",
        discountId: discountId ?? campaign.discountId,
      });

      return { success: true, message: "Campaign activated!" };
    }

    case "deactivate": {
      await updateCampaign(id, session.shop, { status: "paused" });
      return { success: true, message: "Campaign paused." };
    }

    case "addGifts": {
      const giftsJson = formData.get("gifts");
      const gifts = JSON.parse(giftsJson || "[]");
      await addGifts(id, gifts);
      return { success: true };
    }

    case "deleteGift": {
      const giftId = formData.get("giftId");
      await deleteGift(giftId);
      return { success: true };
    }

    case "importUsers": {
      const emailsJson = formData.get("emails");
      const emails = JSON.parse(emailsJson || "[]");
      await addEligibleUsers(id, emails);
      return { success: true };
    }

    case "deleteUser": {
      const userId = formData.get("userId");
      await deleteEligibleUser(userId);
      return { success: true };
    }

    case "clearUsers": {
      await clearEligibleUsers(id);
      return { success: true };
    }

    case "searchProducts": {
      const query = formData.get("query") || "";
      const products = await searchProducts(admin, query);
      return { products };
    }

    default:
      return { error: "Unknown action" };
  }
};

// ─── Component ───────────────────────────────────────────────────────────────

const DEFAULT_TABS = ["Basic Info", "Tiers", "Gifts", "Users", "Styling", "Copy"];

export default function CampaignPage() {
  const { campaign, tiers: initTiers, styling: initStyling, copywriting: initCopy, gifts, eligibleUsers, isNew } = useLoaderData();
  const fetcher = useFetcher();
  const navigate = useNavigate();

  // Form state
  const [activeTab, setActiveTab] = useState(0);
  const [title, setTitle] = useState(campaign?.title || "New Campaign");
  const [status, setStatus] = useState(campaign?.status || "draft");
  const [startTime, setStartTime] = useState(
    campaign?.startTime ? new Date(campaign.startTime).toISOString().slice(0, 16) : ""
  );
  const [endTime, setEndTime] = useState(
    campaign?.endTime ? new Date(campaign.endTime).toISOString().slice(0, 16) : ""
  );
  const [requireEligibility, setRequireEligibility] = useState(campaign?.requireEligibility || false);
  const [giftTag, setGiftTag] = useState(campaign?.giftTag || "is_free_gift");
  const [discountMessage, setDiscountMessage] = useState(campaign?.discountMessage || "Free Gift 🎁");
  const [tiers, setTiers] = useState(initTiers);
  const [styling, setStyling] = useState(initStyling);
  const [copywriting, setCopywriting] = useState(initCopy);

  // Gift search state
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [userEmailInput, setUserEmailInput] = useState("");
  const [csvInput, setCsvInput] = useState("");

  const lastAction = fetcher.data;
  const isLoading = fetcher.state !== "idle";

  // ── Save Campaign ──
  function saveCampaign() {
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
  }

  // ── Activate / Pause ──
  function toggleActivate() {
    const actionType = campaign?.status === "active" ? "deactivate" : "activate";
    const fd = new FormData();
    fd.append("actionType", actionType);
    fetcher.submit(fd, { method: "POST" });
  }

  // ── Tiers ──
  function addTier() {
    setTiers([...tiers, { threshold: 0, allowance: 0 }]);
  }
  function removeTier(i) {
    setTiers(tiers.filter((_, idx) => idx !== i));
  }
  function updateTier(i, field, val) {
    const updated = [...tiers];
    updated[i] = { ...updated[i], [field]: parseFloat(val) || 0 };
    setTiers(updated);
  }

  // ── Product Search ──
  function handleProductSearch() {
    const fd = new FormData();
    fd.append("actionType", "searchProducts");
    fd.append("query", searchQuery);
    fetcher.submit(fd, { method: "POST" });
  }

  function addGiftFromVariant(product, variant) {
    const giftData = [{
      productId: product.id,
      variantId: variant.id,
      title: product.title,
      variantTitle: variant.title !== "Default Title" ? variant.title : "",
      price: variant.price,
      compareAtPrice: variant.compareAtPrice,
      imageUrl: product.images?.nodes?.[0]?.url || null,
      handle: product.handle,
      inventoryLimit: 0,
    }];
    const fd = new FormData();
    fd.append("actionType", "addGifts");
    fd.append("gifts", JSON.stringify(giftData));
    fetcher.submit(fd, { method: "POST" });
    setSearchResults([]);
    setSearchQuery("");
  }

  function handleDeleteGift(giftId) {
    if (!confirm("Remove this gift?")) return;
    const fd = new FormData();
    fd.append("actionType", "deleteGift");
    fd.append("giftId", giftId);
    fetcher.submit(fd, { method: "POST" });
  }

  // ── Users ──
  function importUsers() {
    const lines = userEmailInput.split("\n").map(e => e.trim()).filter(Boolean);
    if (!lines.length) return;
    const fd = new FormData();
    fd.append("actionType", "importUsers");
    fd.append("emails", JSON.stringify(lines));
    fetcher.submit(fd, { method: "POST" });
    setUserEmailInput("");
  }

  function handleDeleteUser(userId) {
    const fd = new FormData();
    fd.append("actionType", "deleteUser");
    fd.append("userId", userId);
    fetcher.submit(fd, { method: "POST" });
  }

  function handleClearUsers() {
    if (!confirm("Clear all eligible users?")) return;
    const fd = new FormData();
    fd.append("actionType", "clearUsers");
    fetcher.submit(fd, { method: "POST" });
  }

  // Show search results from fetcher
  const displayedProducts = lastAction?.products ?? searchResults;

  return (
    <s-page heading={isNew ? "New Campaign" : `Edit: ${title}`}>
      {/* Primary Action */}
      <s-button
        slot="primary-action"
        variant="primary"
        onClick={saveCampaign}
        loading={isLoading}
      >
        Save
      </s-button>

      {/* Secondary Action */}
      {!isNew && (
        <s-button
          slot="secondary-action"
          tone={campaign?.status === "active" ? "critical" : "success"}
          onClick={toggleActivate}
          loading={isLoading}
        >
          {campaign?.status === "active" ? "Pause Campaign" : "Activate Campaign"}
        </s-button>
      )}

      {/* Feedback */}
      {lastAction?.error && (
        <s-section>
          <s-banner tone="critical">{lastAction.error}</s-banner>
        </s-section>
      )}
      {lastAction?.message && (
        <s-section>
          <s-banner tone="success">{lastAction.message}</s-banner>
        </s-section>
      )}

      {/* Tabs */}
      <s-tabs selected={activeTab} onSelect={(e) => setActiveTab(e.detail.selected)}>
        {DEFAULT_TABS.map((t) => (
          <s-tab key={t}>{t}</s-tab>
        ))}
      </s-tabs>

      {/* ── Tab 0: Basic Info ── */}
      {activeTab === 0 && (
        <s-section heading="Basic Info">
          <s-stack direction="block" gap="base">
            <s-text-field
              label="Campaign Title"
              value={title}
              onChange={(e) => setTitle(e.detail.value)}
            />
            <s-select
              label="Status"
              value={status}
              onChange={(e) => setStatus(e.detail.value)}
            >
              <option value="draft">Draft</option>
              <option value="active">Active</option>
              <option value="paused">Paused</option>
              <option value="ended">Ended</option>
            </s-select>
            <s-text-field
              label="Start Time"
              type="datetime-local"
              value={startTime}
              onChange={(e) => setStartTime(e.detail.value)}
            />
            <s-text-field
              label="End Time"
              type="datetime-local"
              value={endTime}
              onChange={(e) => setEndTime(e.detail.value)}
            />
            <s-checkbox
              label="Require Eligibility (restrict to specific users)"
              checked={requireEligibility}
              onChange={(e) => setRequireEligibility(e.detail.checked)}
            />
            <s-text-field
              label="Gift Tag (used to identify gift products)"
              value={giftTag}
              onChange={(e) => setGiftTag(e.detail.value)}
              helpText="Products with this tag will be treated as gifts"
            />
            <s-text-field
              label="Discount Message"
              value={discountMessage}
              onChange={(e) => setDiscountMessage(e.detail.value)}
              helpText="Message shown in checkout for the discount"
            />
          </s-stack>
        </s-section>
      )}

      {/* ── Tab 1: Tiers ── */}
      {activeTab === 1 && (
        <s-section heading="Spend Tiers">
          <s-stack direction="block" gap="base">
            <s-paragraph>Define spending thresholds and corresponding gift allowances.</s-paragraph>
            {tiers.map((tier, i) => (
              <s-stack key={i} direction="inline" gap="base" alignment="center">
                <s-text-field
                  label={`Tier ${i + 1} — Spend $`}
                  type="number"
                  value={String(tier.threshold)}
                  onChange={(e) => updateTier(i, "threshold", e.detail.value)}
                />
                <s-text-field
                  label="Gift Allowance $"
                  type="number"
                  value={String(tier.allowance)}
                  onChange={(e) => updateTier(i, "allowance", e.detail.value)}
                />
                <s-button tone="critical" size="slim" onClick={() => removeTier(i)}>
                  Remove
                </s-button>
              </s-stack>
            ))}
            <s-button onClick={addTier}>+ Add Tier</s-button>
          </s-stack>
        </s-section>
      )}

      {/* ── Tab 2: Gifts ── */}
      {activeTab === 2 && (
        <s-section heading="Gift Products">
          {isNew ? (
            <s-banner tone="info">Save the campaign first to add gifts.</s-banner>
          ) : (
            <s-stack direction="block" gap="base">
              {/* Search */}
              <s-stack direction="inline" gap="tight">
                <s-text-field
                  label="Search Products"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.detail.value)}
                  placeholder="Search by title..."
                />
                <s-button onClick={handleProductSearch} loading={isLoading}>Search</s-button>
              </s-stack>

              {/* Search Results */}
              {displayedProducts.length > 0 && (
                <s-section heading="Results">
                  {displayedProducts.map((product) => (
                    <s-stack key={product.id} direction="block" gap="tight">
                      <s-text weight="bold">{product.title}</s-text>
                      {product.variants?.nodes?.map((variant) => (
                        <s-stack key={variant.id} direction="inline" gap="tight" alignment="center">
                          <s-text>{variant.title} — ${variant.price}</s-text>
                          <s-button
                            size="slim"
                            onClick={() => addGiftFromVariant(product, variant)}
                          >
                            Add as Gift
                          </s-button>
                        </s-stack>
                      ))}
                    </s-stack>
                  ))}
                </s-section>
              )}

              {/* Existing Gifts */}
              {gifts.length > 0 ? (
                <s-data-table>
                  <s-data-table-row slot="headings">
                    <s-data-table-cell>Product</s-data-table-cell>
                    <s-data-table-cell>Variant</s-data-table-cell>
                    <s-data-table-cell>Price</s-data-table-cell>
                    <s-data-table-cell>Limit</s-data-table-cell>
                    <s-data-table-cell>Used</s-data-table-cell>
                    <s-data-table-cell>Active</s-data-table-cell>
                    <s-data-table-cell></s-data-table-cell>
                  </s-data-table-row>
                  {gifts.map((g) => (
                    <s-data-table-row key={g.id}>
                      <s-data-table-cell>{g.title}</s-data-table-cell>
                      <s-data-table-cell>{g.variantTitle || "—"}</s-data-table-cell>
                      <s-data-table-cell>${g.price.toFixed(2)}</s-data-table-cell>
                      <s-data-table-cell>{g.inventoryLimit || "Unlimited"}</s-data-table-cell>
                      <s-data-table-cell>{g.inventoryUsed}</s-data-table-cell>
                      <s-data-table-cell>{g.isActive ? "✓" : "✗"}</s-data-table-cell>
                      <s-data-table-cell>
                        <s-button
                          size="slim"
                          tone="critical"
                          onClick={() => handleDeleteGift(g.id)}
                        >
                          Remove
                        </s-button>
                      </s-data-table-cell>
                    </s-data-table-row>
                  ))}
                </s-data-table>
              ) : (
                <s-paragraph>No gifts added yet. Search for products above.</s-paragraph>
              )}
            </s-stack>
          )}
        </s-section>
      )}

      {/* ── Tab 3: Users ── */}
      {activeTab === 3 && (
        <s-section heading="Eligible Users">
          {isNew ? (
            <s-banner tone="info">Save the campaign first to add users.</s-banner>
          ) : (
            <s-stack direction="block" gap="base">
              <s-paragraph>
                {requireEligibility
                  ? "Only users in this list can access the GWP campaign."
                  : "Eligibility check is disabled. All users can participate."}
              </s-paragraph>

              <s-text-field
                label="Add Emails (one per line)"
                multiline={4}
                value={userEmailInput}
                onChange={(e) => setUserEmailInput(e.detail.value)}
                placeholder="user@example.com&#10;another@example.com"
              />
              <s-stack direction="inline" gap="tight">
                <s-button onClick={importUsers} loading={isLoading}>Import Emails</s-button>
                <s-button tone="critical" onClick={handleClearUsers}>Clear All</s-button>
              </s-stack>

              {eligibleUsers.length > 0 && (
                <s-data-table>
                  <s-data-table-row slot="headings">
                    <s-data-table-cell>Email</s-data-table-cell>
                    <s-data-table-cell>Added</s-data-table-cell>
                    <s-data-table-cell></s-data-table-cell>
                  </s-data-table-row>
                  {eligibleUsers.map((u) => (
                    <s-data-table-row key={u.id}>
                      <s-data-table-cell>{u.email}</s-data-table-cell>
                      <s-data-table-cell>
                        {new Date(u.createdAt).toLocaleDateString()}
                      </s-data-table-cell>
                      <s-data-table-cell>
                        <s-button
                          size="slim"
                          tone="critical"
                          onClick={() => handleDeleteUser(u.id)}
                        >
                          Remove
                        </s-button>
                      </s-data-table-cell>
                    </s-data-table-row>
                  ))}
                </s-data-table>
              )}
              {eligibleUsers.length === 0 && (
                <s-paragraph>No eligible users yet.</s-paragraph>
              )}
            </s-stack>
          )}
        </s-section>
      )}

      {/* ── Tab 4: Styling ── */}
      {activeTab === 4 && (
        <s-section heading="Widget Styling">
          <s-stack direction="block" gap="base">
            {[
              ["primaryColor", "Primary Color"],
              ["secondaryColor", "Secondary Color"],
              ["accentColor", "Accent Color"],
              ["progressBarColor", "Progress Bar Color"],
              ["badgeColor", "Badge Color"],
            ].map(([key, label]) => (
              <s-stack key={key} direction="inline" gap="tight" alignment="center">
                <s-text-field
                  label={label}
                  value={styling[key] || ""}
                  onChange={(e) => setStyling({ ...styling, [key]: e.detail.value })}
                />
                <input
                  type="color"
                  value={styling[key] || "#000000"}
                  onChange={(e) => setStyling({ ...styling, [key]: e.target.value })}
                  style={{ width: 40, height: 40, border: "none", cursor: "pointer" }}
                />
              </s-stack>
            ))}
            <s-text-field
              label="Border Radius"
              value={styling.borderRadius || "12px"}
              onChange={(e) => setStyling({ ...styling, borderRadius: e.detail.value })}
              helpText="e.g. 8px, 12px, 50%"
            />
            <s-select
              label="Card Style"
              value={styling.cardStyle || "elevated"}
              onChange={(e) => setStyling({ ...styling, cardStyle: e.detail.value })}
            >
              <option value="elevated">Elevated (with shadow)</option>
              <option value="flat">Flat (no shadow)</option>
              <option value="bordered">Bordered</option>
            </s-select>
          </s-stack>
        </s-section>
      )}

      {/* ── Tab 5: Copy ── */}
      {activeTab === 5 && (
        <s-section heading="Copywriting">
          <s-stack direction="block" gap="base">
            {Object.keys(copywriting).map((key) => (
              <s-text-field
                key={key}
                label={key.replace(/([A-Z])/g, " $1").trim()}
                value={copywriting[key] || ""}
                onChange={(e) =>
                  setCopywriting({ ...copywriting, [key]: e.detail.value })
                }
              />
            ))}
          </s-stack>
        </s-section>
      )}
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
