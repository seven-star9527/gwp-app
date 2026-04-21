/**
 * GWP Cart Widget JS — Core Frontend
 * Handles gift selection, allowance tracking, and cart integration.
 */
(function () {
  "use strict";

  const root = document.getElementById("gwp-cart-root");
  if (!root || root.dataset.enable === "false") return;

  const PROXY_BASE = root.dataset.proxyBase || "/apps/gwp";
  const SHOW_PROGRESS = root.dataset.showProgress !== "false";

  // ── State ──────────────────────────────────────────────────────────
  let campaign = null;
  let tiers = [];
  let gifts = [];
  let copywriting = {};
  let selectedGiftVariantIds = new Set();
  let currentAllowance = 0;
  let regularTotal = parseFloat(root.dataset.cartTotal || "0");
  let customerEmail = root.dataset.customerEmail || "";

  // ── Init ───────────────────────────────────────────────────────────
  async function init() {
    try {
      // 1. Fetch campaign
      const campaignRes = await fetch(`${PROXY_BASE}/campaign`);
      if (!campaignRes.ok) return;
      const campaignData = await campaignRes.json();
      campaign = campaignData.campaign;
      if (!campaign) return;

      tiers = campaign.tiers || [];
      copywriting = campaign.copywriting || {};

      // 2. Check eligibility
      if (campaign.requireEligibility) {
        if (!customerEmail) return; // No email = hide widget
        const elgRes = await fetch(
          `${PROXY_BASE}/eligibility?email=${encodeURIComponent(customerEmail)}&shop=${encodeURIComponent(getShopDomain())}`
        );
        if (elgRes.ok) {
          const elgData = await elgRes.json();
          if (!elgData.eligible) return;
        } else {
          return;
        }
      }

      // 3. Apply styles + copy
      applyStyles(campaign.styling || {});
      applyCopy(copywriting);

      // 4. Fetch gifts
      const giftsRes = await fetch(
        `${PROXY_BASE}/gifts?campaign_id=${campaign.id}`
      );
      if (giftsRes.ok) {
        const giftsData = await giftsRes.json();
        gifts = giftsData.gifts || [];
      }

      // 5. Show widget and refresh state
      root.style.display = "";
      await refreshCartState();

      // 6. Bind events
      bindEvents();
    } catch (err) {
      console.error("[GWP Cart]", err);
    }
  }

  // ── Apply Styling ──────────────────────────────────────────────────
  function applyStyles(styling) {
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

  // ── Apply Copywriting ──────────────────────────────────────────────
  function applyCopy(copy) {
    setText("gwp-widget-title", copy.cartWidgetTitle);
    setText("gwp-cta-btn", copy.cartWidgetCta);
    setText("gwp-modal-title", copy.modalTitle);
  }

  function setText(id, text) {
    const el = document.getElementById(id);
    if (el && text) el.textContent = text;
  }

  // ── Refresh Cart State ─────────────────────────────────────────────
  async function refreshCartState() {
    try {
      const res = await fetch("/cart.js");
      const cart = await res.json();

      selectedGiftVariantIds = new Set();
      regularTotal = 0;

      for (const item of cart.items) {
        const isGiftByProp = item.properties?._is_gift === "true";
        const isGiftByTag =
          item.product_tags &&
          item.product_tags.split(",").some((t) => t.trim() === "is_free_gift");

        if (isGiftByProp || isGiftByTag) {
          selectedGiftVariantIds.add(String(item.variant_id));
        } else {
          // ⚠️ final_line_price is in cents — divide by 100
          regularTotal += (item.final_line_price || 0) / 100;
        }
      }

      matchTier();
      updateWidget();
      updateSelectedGiftsDisplay();
    } catch (err) {
      console.error("[GWP] refreshCartState error:", err);
    }
  }

  // ── Match Tier ─────────────────────────────────────────────────────
  function matchTier() {
    if (!tiers.length) {
      currentAllowance = 0;
      return;
    }

    const sorted = [...tiers].sort((a, b) => b.threshold - a.threshold);
    currentAllowance = 0;
    for (const t of sorted) {
      if (regularTotal >= parseFloat(t.threshold)) {
        currentAllowance = parseFloat(t.allowance);
        break;
      }
    }
  }

  function getNextTier() {
    const ascSorted = [...tiers].sort((a, b) => a.threshold - b.threshold);
    return ascSorted.find((t) => parseFloat(t.threshold) > regularTotal) || null;
  }

  // ── Update Widget UI ───────────────────────────────────────────────
  function updateWidget() {
    const progressContainer = document.getElementById("gwp-progress-container");
    const progressText = document.getElementById("gwp-progress-text");
    const progressFill = document.getElementById("gwp-progress-fill");
    const ctaBtn = document.getElementById("gwp-cta-btn");

    if (!SHOW_PROGRESS && progressContainer) {
      progressContainer.style.display = "none";
    }

    const nextTier = getNextTier();
    const copy = copywriting;

    if (nextTier) {
      const diff = (parseFloat(nextTier.threshold) - regularTotal).toFixed(2);
      const pct = Math.min(
        100,
        (regularTotal / parseFloat(nextTier.threshold)) * 100
      );

      if (progressText) {
        progressText.innerHTML = `${copy.progressPrefix || "Spend"} <strong>$${diff}</strong> ${copy.progressSuffix || "more to unlock the next tier!"}`;
      }
      if (progressFill) progressFill.style.width = `${pct}%`;
    } else if (tiers.length) {
      // Max tier reached
      if (progressText) {
        progressText.textContent = copy.tierReachedText || "You've reached the maximum tier! 🎉";
      }
      if (progressFill) progressFill.style.width = "100%";
    } else {
      // No tiers matched yet
      const firstTier = [...tiers].sort((a, b) => a.threshold - b.threshold)[0];
      if (firstTier) {
        const pct = Math.min(
          100,
          (regularTotal / parseFloat(firstTier.threshold)) * 100
        );
        const diff = Math.max(0, parseFloat(firstTier.threshold) - regularTotal).toFixed(2);
        if (progressText) {
          progressText.innerHTML = `${copy.progressPrefix || "Spend"} <strong>$${diff}</strong> ${copy.progressSuffix || "more to unlock gifts!"}`;
        }
        if (progressFill) progressFill.style.width = `${pct}%`;
      }
    }

    // Enable / disable CTA
    if (ctaBtn) {
      const hasAllowance = currentAllowance > 0;
      ctaBtn.disabled = !hasAllowance;
      if (hasAllowance) {
        ctaBtn.textContent = copy.cartWidgetCta || "Choose Your Free Gifts";
      } else {
        ctaBtn.textContent = copy.emptyState || "Add items to unlock free gifts";
      }
    }
  }

  // ── Update Selected Gifts Display ─────────────────────────────────
  function updateSelectedGiftsDisplay() {
    const row = document.getElementById("gwp-selected-gifts-row");
    if (!row) return;
    row.innerHTML = "";

    for (const variantId of selectedGiftVariantIds) {
      const gift = gifts.find((g) => String(g.variantId).endsWith(variantId) || String(variantId) === extractNumeric(g.variantId));
      if (!gift) continue;

      const thumb = document.createElement("div");
      thumb.className = "gwp-selected-gift-thumb";
      thumb.innerHTML = gift.imageUrl
        ? `<img src="${gift.imageUrl}" alt="${escHtml(gift.title)}" title="${escHtml(gift.title)}">`
        : `<span style="font-size:1.5rem;display:flex;align-items:center;justify-content:center;height:100%">🎁</span>`;
      row.appendChild(thumb);
    }
  }

  // ── Open Modal ─────────────────────────────────────────────────────
  function openModal() {
    const overlay = document.getElementById("gwp-modal-overlay");
    if (overlay) overlay.classList.add("open");
    renderModalGifts();
  }

  function closeModal() {
    const overlay = document.getElementById("gwp-modal-overlay");
    if (overlay) overlay.classList.remove("open");
  }

  // ── Render Modal Gifts ─────────────────────────────────────────────
  function renderModalGifts() {
    const grid = document.getElementById("gwp-mgift-grid");
    const allowanceEl = document.getElementById("gwp-modal-allowance");
    const remainingEl = document.getElementById("gwp-modal-remaining");
    if (!grid) return;

    const selectedTotal = calcSelectedTotal();
    const remaining = Math.max(0, currentAllowance - selectedTotal);

    if (allowanceEl) allowanceEl.textContent = `$${currentAllowance.toFixed(2)}`;
    if (remainingEl) remainingEl.textContent = `$${remaining.toFixed(2)}`;

    if (!gifts.length) {
      grid.innerHTML = `<p style="color:var(--gwp-gray-500);text-align:center;padding:20px">No gifts available.</p>`;
      return;
    }

    grid.innerHTML = gifts
      .map((gift) => {
        const numericId = extractNumeric(gift.variantId);
        const isSelected = selectedGiftVariantIds.has(numericId) || selectedGiftVariantIds.has(gift.variantId);
        const canAfford = gift.price <= remaining + 0.01;
        const isSoldOut = !gift.inStock;

        let btnClass = "gwp-mgift__btn--add";
        let btnText = copywriting.addToCartText || "Add Gift";
        let btnDisabled = "";

        if (isSelected) {
          btnClass = "gwp-mgift__btn--remove";
          btnText = copywriting.removeText || "Remove";
        } else if (isSoldOut) {
          btnClass = "gwp-mgift__btn--disabled";
          btnText = copywriting.soldOutText || "Sold Out";
          btnDisabled = "disabled";
        } else if (!canAfford) {
          btnClass = "gwp-mgift__btn--disabled";
          btnText = "Over Limit";
          btnDisabled = "disabled";
        }

        return `
        <div class="gwp-mgift${isSelected ? " selected" : ""}${isSoldOut || (!isSelected && !canAfford) ? " disabled" : ""}">
          <div class="gwp-mgift__check">✓</div>
          ${
            gift.imageUrl
              ? `<img class="gwp-mgift__image" src="${gift.imageUrl}" alt="${escHtml(gift.title)}" loading="lazy">`
              : `<div class="gwp-mgift__image" style="display:flex;align-items:center;justify-content:center;background:var(--gwp-gray-100);font-size:2.5rem">🎁</div>`
          }
          <div class="gwp-mgift__body">
            <div class="gwp-mgift__title">${escHtml(gift.title)}${gift.variantTitle ? ` - ${escHtml(gift.variantTitle)}` : ""}</div>
            <div class="gwp-mgift__price">$${gift.price.toFixed(2)}</div>
            <button
              class="gwp-mgift__btn ${btnClass}"
              ${btnDisabled}
              data-variant-id="${gift.variantId}"
              data-action="${isSelected ? "remove" : "add"}"
              onclick="window.__gwpHandleGiftClick('${gift.variantId}', '${isSelected ? "remove" : "add"}')"
            >${btnText}</button>
          </div>
        </div>
      `;
      })
      .join("");
  }

  // ── Add Gift to Cart ───────────────────────────────────────────────
  async function addGiftToCart(variantId) {
    const numericId = extractNumeric(variantId);
    try {
      const res = await fetch("/cart/add.js", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: [
            {
              id: parseInt(numericId, 10),
              quantity: 1,
              properties: {
                _is_gift: "true",
                _gwp_campaign: campaign.id,
              },
            },
          ],
        }),
      });
      if (!res.ok) throw new Error("Add to cart failed");

      selectedGiftVariantIds.add(numericId);
      await refreshCartState();
      renderModalGifts();
      dispatchCartUpdate();
    } catch (err) {
      console.error("[GWP] addGiftToCart:", err);
    }
  }

  // ── Remove Gift from Cart ──────────────────────────────────────────
  async function removeGiftFromCart(variantId) {
    const numericId = extractNumeric(variantId);
    try {
      const cartRes = await fetch("/cart.js");
      const cart = await cartRes.json();

      // Find matching line item
      const lineItem = cart.items.find(
        (item) =>
          String(item.variant_id) === numericId &&
          item.properties?._is_gift === "true"
      );

      if (!lineItem) {
        // Fallback: just refresh state
        await refreshCartState();
        return;
      }

      await fetch("/cart/change.js", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: lineItem.key, quantity: 0 }),
      });

      selectedGiftVariantIds.delete(numericId);
      selectedGiftVariantIds.delete(variantId);
      await refreshCartState();
      renderModalGifts();
      dispatchCartUpdate();
    } catch (err) {
      console.error("[GWP] removeGiftFromCart:", err);
    }
  }

  // ── Calculate Selected Total ───────────────────────────────────────
  function calcSelectedTotal() {
    let total = 0;
    for (const variantId of selectedGiftVariantIds) {
      const gift = gifts.find(
        (g) =>
          extractNumeric(g.variantId) === variantId ||
          g.variantId === variantId
      );
      if (gift) total += gift.price;
    }
    return total;
  }

  // ── Bind Events ────────────────────────────────────────────────────
  function bindEvents() {
    // CTA button
    const ctaBtn = document.getElementById("gwp-cta-btn");
    if (ctaBtn) ctaBtn.addEventListener("click", openModal);

    // Close buttons
    const closeBtn = document.getElementById("gwp-modal-close");
    if (closeBtn) closeBtn.addEventListener("click", closeModal);

    const doneBtn = document.getElementById("gwp-modal-done");
    if (doneBtn) doneBtn.addEventListener("click", closeModal);

    // Overlay click
    const overlay = document.getElementById("gwp-modal-overlay");
    if (overlay) {
      overlay.addEventListener("click", (e) => {
        if (e.target === overlay) closeModal();
      });
    }

    // ESC key
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeModal();
    });

    // Listen for cart update events (from theme or other scripts)
    document.addEventListener("cart:updated", () => {
      setTimeout(refreshCartState, 300);
    });

    // Also listen for common Shopify cart events
    document.addEventListener("cart:refresh", () => {
      setTimeout(refreshCartState, 300);
    });
  }

  // ── Dispatch Cart Update Event ─────────────────────────────────────
  function dispatchCartUpdate() {
    document.dispatchEvent(new CustomEvent("cart:updated", { bubbles: true }));
  }

  // ── Helpers ────────────────────────────────────────────────────────
  function extractNumeric(gid) {
    if (!gid) return "";
    const parts = String(gid).split("/");
    return parts[parts.length - 1];
  }

  function getShopDomain() {
    return window.Shopify?.shop || window.location.hostname;
  }

  function escHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // Expose click handler globally for inline onclick handlers
  window.__gwpHandleGiftClick = function (variantId, action) {
    if (action === "add") {
      addGiftToCart(variantId);
    } else {
      removeGiftFromCart(variantId);
    }
  };

  // ── Boot ───────────────────────────────────────────────────────────
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
