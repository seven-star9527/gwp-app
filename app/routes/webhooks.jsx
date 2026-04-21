// app/routes/webhooks.jsx — Shopify Webhooks
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { incrementGiftUsage } from "../models/campaign.server";

export const action = async ({ request }) => {
  const { topic, shop, session, payload } = await authenticate.webhook(request);

  console.log(`[Webhook] topic=${topic}, shop=${shop}`);

  switch (topic) {
    case "ORDERS_CREATE": {
      const lineItems = payload?.line_items ?? [];
      for (const item of lineItems) {
        const isGift =
          item.properties?.some(
            (p) => p.name === "_is_gift" && p.value === "true"
          ) ||
          (item.product_tags &&
            item.product_tags.split(",").some((t) => t.trim() === "is_free_gift"));

        if (isGift && item.variant_id) {
          // Convert numeric variant_id to GID format
          const variantGid = `gid://shopify/ProductVariant/${item.variant_id}`;
          await incrementGiftUsage(variantGid, item.quantity || 1);
        }
      }
      break;
    }

    case "APP_UNINSTALLED": {
      if (session) {
        await db.session.deleteMany({ where: { shop } });
      }
      break;
    }

    default:
      console.log(`[Webhook] Unhandled topic: ${topic}`);
  }

  return new Response(null, { status: 200 });
};
