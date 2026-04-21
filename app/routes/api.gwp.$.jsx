// app/routes/api.gwp.$.jsx — App Proxy API
// Routes: /apps/gwp/campaign | /apps/gwp/gifts | /apps/gwp/eligibility
import crypto from "crypto";
import { getActiveCampaign, checkUserEligibility } from "../models/campaign.server";
import db from "../db.server";

// Verify Shopify App Proxy HMAC signature
function verifyProxySignature(searchParams) {
  // Skip in development
  // eslint-disable-next-line no-undef
  if (process.env.NODE_ENV !== "production") return true;

  const signature = searchParams.get("signature");
  if (!signature) return false;

  const params = new URLSearchParams(searchParams);
  params.delete("signature");

  // Sort params and build query string
  const sortedKeys = [...params.keys()].sort();
  const message = sortedKeys.map((k) => `${k}=${params.get(k)}`).join("&");

  // eslint-disable-next-line no-undef
  const secret = process.env.SHOPIFY_API_SECRET || "";
  const computed = crypto.createHmac("sha256", secret).update(message).digest("hex");

  return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(signature));
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

export async function loader({ request }) {
  const url = new URL(request.url);
  const { searchParams, pathname } = url;

  // Verify proxy signature
  if (!verifyProxySignature(searchParams)) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  // Determine shop from URL params (Shopify injects shop param)
  const shop = searchParams.get("shop");
  if (!shop) return jsonResponse({ error: "Missing shop" }, 400);

  // Route based on path suffix
  const path = pathname.split("/apps/gwp/")[1] || "";
  const route = path.split("?")[0].replace(/\/$/, "");

  // GET /apps/gwp/campaign
  if (route === "campaign") {
    const campaign = await getActiveCampaign(shop);
    if (!campaign) return jsonResponse({ campaign: null });

    return jsonResponse({
      campaign: {
        id: campaign.id,
        title: campaign.title,
        tiers: JSON.parse(campaign.tiers || "[]"),
        styling: JSON.parse(campaign.styling || "{}"),
        copywriting: JSON.parse(campaign.copywriting || "{}"),
        requireEligibility: campaign.requireEligibility,
        discountMessage: campaign.discountMessage,
        giftTag: campaign.giftTag,
      },
    });
  }

  // GET /apps/gwp/gifts?campaign_id=
  if (route === "gifts") {
    const campaignId = searchParams.get("campaign_id");
    if (!campaignId) return jsonResponse({ error: "Missing campaign_id" }, 400);

    const gifts = await db.gift.findMany({
      where: { campaignId, isActive: true },
      orderBy: { sortOrder: "asc" },
    });

    return jsonResponse({
      gifts: gifts.map((g) => ({
        id: g.id,
        variantId: g.variantId,
        productId: g.productId,
        title: g.title,
        variantTitle: g.variantTitle,
        price: g.price,
        compareAtPrice: g.compareAtPrice,
        imageUrl: g.imageUrl,
        handle: g.handle,
        inventoryLimit: g.inventoryLimit,
        inventoryUsed: g.inventoryUsed,
        inStock: g.inventoryLimit === 0 || g.inventoryUsed < g.inventoryLimit,
        remaining:
          g.inventoryLimit === 0
            ? null
            : Math.max(0, g.inventoryLimit - g.inventoryUsed),
      })),
    });
  }

  // GET /apps/gwp/eligibility?email=
  if (route === "eligibility") {
    const email = searchParams.get("email");
    if (!email) return jsonResponse({ eligible: false });

    // First check if the campaign requires eligibility
    const campaign = await getActiveCampaign(shop);
    if (!campaign) return jsonResponse({ eligible: false });
    if (!campaign.requireEligibility) return jsonResponse({ eligible: true });

    const eligible = await checkUserEligibility(shop, email);
    return jsonResponse({ eligible });
  }

  return jsonResponse({ error: "Not found" }, 404);
}
