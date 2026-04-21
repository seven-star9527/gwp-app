// @ts-check

/**
 * @typedef {import("../generated/api").RunInput} RunInput
 * @typedef {import("../generated/api").FunctionRunResult} FunctionRunResult
 */

/** @type {FunctionRunResult} */
const NO_DISCOUNT = {
  discountApplicationStrategy: "FIRST",
  discounts: [],
};

/**
 * @param {RunInput} input
 * @returns {FunctionRunResult}
 */
export function run(input) {
  try {
    // 1. 解析配置
    const raw = input?.discountNode?.metafield?.value;
    if (!raw) return NO_DISCOUNT;
    let config;
    try {
      config = JSON.parse(raw);
    } catch {
      return NO_DISCOUNT;
    }
    const {
      tiers = [],
      requireEligibility = false,
      discountMessage = "Free Gift 🎁",
    } = config;
    if (!tiers.length) return NO_DISCOUNT;

    // 2. 用户资格校验
    if (requireEligibility) {
      const c = input?.cart?.buyerIdentity?.customer;
      if (!c) return NO_DISCOUNT;
      if (!c.hasAnyTag && c.metafield?.value !== "true") return NO_DISCOUNT;
    }

    // 3. 分离赠品行 vs 正价行（双重判断：产品标签 + 行属性 _is_gift）
    const giftLines = [],
      regularLines = [];
    for (const line of input.cart.lines) {
      if (isGift(line)) giftLines.push(line);
      else regularLines.push(line);
    }
    if (!giftLines.length) return NO_DISCOUNT;

    // 4. 计算仅正价商品总额（⚠️ parseFloat，防止字符串问题）
    let regularTotal = 0;
    for (const l of regularLines) {
      const p = parseFloat(l.cost.amountPerQuantity.amount);
      if (!isNaN(p)) regularTotal += p * l.quantity;
    }

    // 5. 匹配阶梯（降序找第一个满足的）
    const sorted = [...tiers].sort((a, b) => b.threshold - a.threshold);
    let allowance = 0;
    for (const t of sorted) {
      if (regularTotal >= parseFloat(t.threshold)) {
        allowance = parseFloat(t.allowance);
        break;
      }
    }
    if (allowance <= 0) return NO_DISCOUNT;

    // 6. 展开赠品单元，按单价升序（防高价赠品挤占额度）
    const units = [];
    for (const l of giftLines) {
      const p = parseFloat(l.cost.amountPerQuantity.amount);
      if (isNaN(p) || p <= 0) continue;
      for (let i = 0; i < l.quantity; i++) {
        units.push({ lineId: l.id, unitPrice: p });
      }
    }
    units.sort((a, b) => a.unitPrice - b.unitPrice);

    // 7. 在额度内逐个分配 100% off
    let remaining = allowance;
    /** @type {Record<string, number>} */
    const map = {};
    for (const u of units) {
      if (u.unitPrice <= remaining + 0.001) {
        remaining -= u.unitPrice;
        if (remaining < 0) remaining = 0;
        const currentCount = map[u.lineId] || 0;
        map[u.lineId] = currentCount + 1;
      }
    }

    // 8. 构建 targets
    const targets = Object.entries(map)
      .filter(([, q]) => q > 0)
      .map(([id, q]) => ({ cartLine: { id, quantity: q } }));
    if (!targets.length) return NO_DISCOUNT;

    return {
      discountApplicationStrategy: "FIRST",
      discounts: [
        {
          targets,
          value: { percentage: { value: "100.0" } },
          message: discountMessage,
        },
      ],
    };
  } catch {
    return NO_DISCOUNT;
  }
}

/**
 * 判断购物车行是否为赠品（双重判断）
 * @param {any} line
 * @returns {boolean}
 */
function isGift(line) {
  // 产品 tag 判断
  if (line.merchandise?.product?.hasAnyTag) return true;
  // 行属性判断
  if (line.attribute?.value === "true") return true;
  return false;
}