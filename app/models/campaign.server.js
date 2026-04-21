// app/models/campaign.server.js
import db from "../db.server";

// ─── Default Configs ────────────────────────────────────────────────────────

export function getDefaultStyling() {
  return {
    primaryColor: "#FF6B35",
    secondaryColor: "#FFF8F0",
    accentColor: "#2D3436",
    borderRadius: "12px",
    cardStyle: "elevated",
    progressBarColor: "#FF6B35",
    badgeColor: "#FF6B35",
  };
}

export function getDefaultCopywriting() {
  return {
    landingTitle: "🎁 Free Gifts For You!",
    landingSubtitle: "Spend more, earn more free gifts!",
    cartWidgetTitle: "🎁 You've unlocked free gifts!",
    cartWidgetCta: "Choose Your Free Gifts",
    modalTitle: "Choose Your Free Gifts",
    progressPrefix: "Spend",
    progressSuffix: "more to unlock the next tier!",
    emptyState: "Add items to your cart to unlock free gifts",
    tierReachedText: "You've reached the maximum tier! 🎉",
    addToCartText: "Add Gift",
    removeText: "Remove",
    soldOutText: "Sold Out",
    allowanceLabel: "Gift Allowance",
    remainingLabel: "Remaining",
  };
}

export function getDefaultTiers() {
  return [
    { threshold: 39, allowance: 20 },
    { threshold: 59, allowance: 30 },
    { threshold: 79, allowance: 40 },
    { threshold: 99, allowance: 50 },
    { threshold: 119, allowance: 70 },
    { threshold: 139, allowance: 100 },
    { threshold: 159, allowance: 120 },
  ];
}

// ─── Campaign CRUD ───────────────────────────────────────────────────────────

export async function getCampaigns(shop) {
  return db.campaign.findMany({
    where: { shop },
    include: {
      _count: {
        select: { gifts: true, eligibleUsers: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function getCampaign(id, shop) {
  return db.campaign.findFirst({
    where: { id, shop },
    include: {
      gifts: { orderBy: { sortOrder: "asc" } },
      eligibleUsers: { orderBy: { createdAt: "asc" } },
    },
  });
}

export async function createCampaign(data) {
  const { tiers, styling, copywriting, ...rest } = data;
  return db.campaign.create({
    data: {
      ...rest,
      tiers: JSON.stringify(tiers ?? getDefaultTiers()),
      styling: JSON.stringify(styling ?? getDefaultStyling()),
      copywriting: JSON.stringify(copywriting ?? getDefaultCopywriting()),
    },
  });
}

export async function updateCampaign(id, shop, data) {
  const { tiers, styling, copywriting, ...rest } = data;
  const updateData = { ...rest };
  if (tiers !== undefined) updateData.tiers = JSON.stringify(tiers);
  if (styling !== undefined) updateData.styling = JSON.stringify(styling);
  if (copywriting !== undefined)
    updateData.copywriting = JSON.stringify(copywriting);

  return db.campaign.update({
    where: { id },
    data: updateData,
  });
}

export async function deleteCampaign(id, shop) {
  return db.campaign.delete({ where: { id } });
}

export async function getActiveCampaign(shop) {
  const now = new Date();
  return db.campaign.findFirst({
    where: {
      shop,
      status: "active",
      startTime: { lte: now },
      endTime: { gte: now },
    },
    include: {
      gifts: {
        where: { isActive: true },
        orderBy: { sortOrder: "asc" },
      },
    },
  });
}

// ─── Gift Operations ─────────────────────────────────────────────────────────

export async function addGifts(campaignId, gifts) {
  return db.gift.createMany({
    data: gifts.map((g, i) => ({
      campaignId,
      productId: g.productId,
      variantId: g.variantId,
      title: g.title,
      variantTitle: g.variantTitle ?? "",
      price: parseFloat(g.price) || 0,
      compareAtPrice: g.compareAtPrice ? parseFloat(g.compareAtPrice) : null,
      imageUrl: g.imageUrl ?? null,
      handle: g.handle ?? "",
      inventoryLimit: parseInt(g.inventoryLimit) || 0,
      sortOrder: i,
    })),
    skipDuplicates: false,
  });
}

export async function updateGift(id, data) {
  return db.gift.update({ where: { id }, data });
}

export async function deleteGift(id) {
  return db.gift.delete({ where: { id } });
}

export async function incrementGiftUsage(variantId, qty = 1) {
  const gift = await db.gift.findFirst({ where: { variantId } });
  if (!gift) return null;

  const updated = await db.gift.update({
    where: { id: gift.id },
    data: { inventoryUsed: { increment: qty } },
  });

  // Auto-deactivate if inventory exhausted
  if (
    updated.inventoryLimit > 0 &&
    updated.inventoryUsed >= updated.inventoryLimit
  ) {
    await db.gift.update({ where: { id: gift.id }, data: { isActive: false } });
  }

  return updated;
}

// ─── EligibleUser Operations ──────────────────────────────────────────────────

export async function addEligibleUsers(campaignId, emails) {
  return db.eligibleUser.createMany({
    data: emails.map((email) => ({
      campaignId,
      email: email.toLowerCase().trim(),
    })),
    skipDuplicates: true,
  });
}

export async function checkUserEligibility(shop, email) {
  const now = new Date();
  const user = await db.eligibleUser.findFirst({
    where: {
      email: email.toLowerCase().trim(),
      campaign: {
        shop,
        status: "active",
        startTime: { lte: now },
        endTime: { gte: now },
      },
    },
  });
  return !!user;
}

export async function deleteEligibleUser(id) {
  return db.eligibleUser.delete({ where: { id } });
}

export async function clearEligibleUsers(campaignId) {
  return db.eligibleUser.deleteMany({ where: { campaignId } });
}
