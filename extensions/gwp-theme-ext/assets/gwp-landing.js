/**
 * GWP Landing Page JS
 * Fetches campaign data and renders tiers + gift grid.
 */
(function () {
  "use strict";

  const root = document.getElementById("gwp-landing-root");
  if (!root) return;

  const PROXY_BASE = root.dataset.proxyBase || "/apps/gwp";
  const SHOW_TIERS = root.dataset.showTiers !== "false";
  const SHOW_GIFTS = root.dataset.showGifts !== "false";
  const MAX_GIFTS = parseInt(root.dataset.maxGifts, 10) || 12;

  async function init() {
    try {
      const res = await fetch(`${PROXY_BASE}/campaign`);
      if (!res.ok) return;
      const data = await res.json();
      const campaign = data.campaign;
      if (!campaign) return;

      // Show the root now that we have a campaign
      root.style.display = "";

      // Apply custom styles from campaign styling config
      applyCustomStyles(campaign.styling || {});

      // Apply copywriting
      applyCopywriting(campaign.copywriting || {});

      // Render tiers
      if (SHOW_TIERS && campaign.tiers?.length) {
        renderTiers(campaign.tiers);
      }

      // Fetch and render gifts
      if (SHOW_GIFTS) {
        const giftsRes = await fetch(
          `${PROXY_BASE}/gifts?campaign_id=${campaign.id}`
        );
        if (giftsRes.ok) {
          const giftsData = await giftsRes.json();
          renderGifts(giftsData.gifts || [], campaign, MAX_GIFTS);
        }
      }
    } catch (err) {
      console.error("[GWP Landing]", err);
    }
  }

  function applyCustomStyles(styling) {
    const map = {
      primaryColor: "--gwp-primary",
      secondaryColor: "--gwp-secondary",
      accentColor: "--gwp-accent",
      progressBarColor: "--gwp-progress-color",
      badgeColor: "--gwp-badge-color",
      borderRadius: "--gwp-radius",
    };
    Object.entries(map).forEach(([key, cssVar]) => {
      if (styling[key]) {
        document.documentElement.style.setProperty(cssVar, styling[key]);
      }
    });
  }

  function applyCopywriting(copy) {
    const title = document.getElementById("gwp-landing-title");
    const subtitle = document.getElementById("gwp-landing-subtitle");
    if (title && copy.landingTitle) title.textContent = copy.landingTitle;
    if (subtitle && copy.landingSubtitle)
      subtitle.textContent = copy.landingSubtitle;
  }

  function renderTiers(tiers) {
    const section = document.getElementById("gwp-tiers-section");
    const grid = document.getElementById("gwp-tiers-grid");
    if (!section || !grid) return;

    // Sort ascending by threshold
    const sorted = [...tiers].sort((a, b) => a.threshold - b.threshold);

    grid.innerHTML = sorted
      .map(
        (tier, i) => `
      <div class="gwp-tier-card gwp-animate-in" style="animation-delay:${i * 0.06}s">
        <div class="gwp-tier-card__threshold">$${tier.threshold}</div>
        <div class="gwp-tier-card__label">spend</div>
        <div class="gwp-tier-card__allowance">$${tier.allowance} gift</div>
      </div>
    `
      )
      .join("");

    section.style.display = "";
  }

  function renderGifts(gifts, campaign, maxGifts) {
    const section = document.getElementById("gwp-gifts-section");
    const grid = document.getElementById("gwp-gifts-grid");
    if (!section || !grid) return;

    if (!gifts.length) {
      section.style.display = "none";
      return;
    }

    const displayed = gifts.slice(0, maxGifts);
    grid.innerHTML = displayed
      .map(
        (gift, i) => `
      <div class="gwp-gift-card gwp-animate-in" style="animation-delay:${i * 0.05}s">
        <div class="gwp-gift-card__image-wrapper">
          ${
            gift.imageUrl
              ? `<img class="gwp-gift-card__image" src="${gift.imageUrl}" alt="${escHtml(gift.title)}" loading="lazy">`
              : `<div class="gwp-gift-card__image" style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--gwp-gray-400);font-size:2rem">🎁</div>`
          }
          <div class="gwp-gift-card__badge-free">FREE</div>
          ${
            !gift.inStock
              ? `<div class="gwp-gift-card__soldout-overlay">Sold Out</div>`
              : ""
          }
        </div>
        <div class="gwp-gift-card__body">
          <div class="gwp-gift-card__title">${escHtml(gift.title)}</div>
          ${gift.variantTitle ? `<div class="gwp-gift-card__variant">${escHtml(gift.variantTitle)}</div>` : ""}
          <div class="gwp-gift-card__pricing">
            <span class="gwp-gift-card__price-free">FREE</span>
            ${gift.compareAtPrice ? `<span class="gwp-gift-card__price-original">$${gift.compareAtPrice.toFixed(2)}</span>` : `<span class="gwp-gift-card__price-original">$${gift.price.toFixed(2)}</span>`}
          </div>
        </div>
      </div>
    `
      )
      .join("");

    section.style.display = "";
  }

  function escHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // Boot
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
