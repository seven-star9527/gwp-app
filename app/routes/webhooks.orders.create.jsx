// app/routes/webhooks.orders.create.jsx — Handle orders/create webhook
import { authenticate } from "../shopify.server";
import { incrementGiftUsage } from "../models/campaign.server";

export const action = async ({ request }) => {
    const { topic, shop, payload } = await authenticate.webhook(request);

    console.log(`[Webhook] topic=${topic}, shop=${shop}`);

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

    return new Response();
};