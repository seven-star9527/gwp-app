# GWP Shopify App — 精简执行指南

> **用途**：交给任意 AI 模型，按此文档逐步执行，完成整个项目。

---

## 〇、项目概述

| 项 | 值 |
|---|---|
| 项目名 | gwp-app（Gift With Purchase） |
| 技术栈 | Shopify CLI 3.x + Remix (JS) + Prisma/SQLite + Shopify Functions |
| 部署 | Render (Node) |
| 功能 | 多阶梯购物车赠品：达到消费额 → 解锁对应赠品额度 → 额度内赠品 100% off |

**阶梯表**

| 消费满 | 赠品额度 |
|--------|----------|
| $39 | $20 |
| $59 | $30 |
| $79 | $40 |
| $99 | $50 |
| $119 | $70 |
| $139 | $100 |
| $159 | $120 |

**核心约束**
1. Function 是纯函数（WASM 沙箱），无网络/IO
2. 赠品金额**不计入**正价总额（防白嫖）
3. 赠品按单价**升序**分配额度（防高价伪装）
4. `cost.amountPerQuantity.amount` 是 **String**，必须 `parseFloat`
5. 支持批量导入赠品和用户（CSV）
6. 赠品有独立库存，赠完即止

---

## 一、项目初始化

```bash
shopify app init
# 选 Remix + JavaScript，名称 gwp-app

cd gwp-app
npm install csv-parse multer date-fns

# 生成 Product Discount Function
shopify app generate extension
# Type: Product discount → Name: gwp-discount → Language: JavaScript

# 生成 Theme App Extension
shopify app generate extension
# Type: Theme app extension → Name: gwp-theme-ext
```

---

## 二、最终文件清单

```
gwp-app/
├── prisma/schema.prisma
├── shopify.app.toml
├── package.json                         (修改 scripts)
├── app/
│   ├── db.server.js                     (模板已有，确认即可)
│   ├── shopify.server.js                (模板已有)
│   ├── models/
│   │   ├── campaign.server.js           ★ 新建
│   │   └── shopify-operations.server.js ★ 新建
│   └── routes/
│       ├── app.jsx                      ★ 改写
│       ├── app._index.jsx               ★ 改写
│       ├── app.campaign.$id.jsx         ★ 新建
│       ├── api.gwp.$.jsx                ★ 新建
│       └── webhooks.jsx                 ★ 改写
├── extensions/
│   ├── gwp-discount/
│   │   ├── shopify.extension.toml       ★ 改写
│   │   ├── package.json                 ★ 确认
│   │   └── src/
│   │       ├── run.graphql              ★ 改写
│   │       └── run.js                   ★ 改写（核心Function）
│   └── gwp-theme-ext/
│       ├── shopify.extension.toml       ★ 改写
│       ├── blocks/
│       │   ├── gwp-landing-page.liquid  ★ 新建
│       │   └── gwp-cart-widget.liquid   ★ 新建
│       └── assets/
│           ├── gwp-styles.css           ★ 新建
│           ├── gwp-landing.js           ★ 新建
│           └── gwp-cart.js              ★ 新建（核心前端）
└── render.yaml                          ★ 新建
```

---

## 三、逐文件代码

### 3.1 `prisma/schema.prisma`

```prisma
generator client {
  provider = "prisma-client-js"
}
datasource db {
  provider = "sqlite"
  url      = "file:dev.db"
}

model Session {
  id            String    @id
  shop          String
  state         String
  isOnline      Boolean   @default(false)
  scope         String?
  expires       DateTime?
  accessToken   String
  userId        BigInt?
  firstName     String?
  lastName      String?
  email         String?
  accountOwner  Boolean   @default(false)
  locale        String?
  collaborator  Boolean?  @default(false)
  emailVerified Boolean?  @default(false)
}

model Campaign {
  id                  String    @id @default(uuid())
  shop                String
  title               String
  status              String    @default("draft")
  startTime           DateTime
  endTime             DateTime
  requireEligibility  Boolean   @default(false)
  discountId          String?
  tiers               String    @default("[]")
  styling             String    @default("{}")
  copywriting         String    @default("{}")
  giftTag             String    @default("is_free_gift")
  discountMessage     String    @default("Free Gift")
  createdAt           DateTime  @default(now())
  updatedAt           DateTime  @updatedAt
  gifts               Gift[]
  eligibleUsers       EligibleUser[]
}

model Gift {
  id              String    @id @default(uuid())
  campaignId      String
  campaign        Campaign  @relation(fields: [campaignId], references: [id], onDelete: Cascade)
  productId       String
  variantId       String
  title           String
  variantTitle    String    @default("")
  price           Float
  compareAtPrice  Float?
  imageUrl        String?
  handle          String    @default("")
  inventoryLimit  Int       @default(0)
  inventoryUsed   Int       @default(0)
  isActive        Boolean   @default(true)
  sortOrder       Int       @default(0)
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt
  @@index([campaignId])
}

model EligibleUser {
  id          String    @id @default(uuid())
  campaignId  String
  campaign    Campaign  @relation(fields: [campaignId], references: [id], onDelete: Cascade)
  email       String
  customerId  String?
  createdAt   DateTime  @default(now())
  @@unique([campaignId, email])
  @@index([campaignId])
  @@index([email])
}
```

执行：
```bash
npx prisma migrate dev --name init
npx prisma generate
```

---

### 3.2 `extensions/gwp-discount/shopify.extension.toml`

> ⚠️ 先 `find extensions/gwp-discount -type f` 确认实际结构，GraphQL 文件可能是 `src/run.graphql` 或 `input.graphql`，以下按新版 CLI 写。

```toml
api_version = "2026-01"

[[extensions]]
name = "GWP Product Discount"
handle = "gwp-discount"
type = "function"

  [extensions.build]
  command = ""
  path = "dist/function.wasm"

  [extensions.targeting]
  target = "purchase.product-discount.run"
  input_query = "src/run.graphql"
  export = "run"

  [extensions.ui]
  enable_create = false

    [extensions.ui.paths]
    create = "/app/campaign/new"
    details = "/app/campaign/:id"
```

---

### 3.3 `extensions/gwp-discount/src/run.graphql`

```graphql
query RunInput {
  cart {
    lines {
      id
      quantity
      cost {
        amountPerQuantity { amount currencyCode }
        totalAmount { amount }
      }
      merchandise {
        ... on ProductVariant {
          id
          product {
            id
            hasAnyTag(tags: ["is_free_gift"])
          }
        }
      }
      attribute(key: "_is_gift") { value }
    }
    buyerIdentity {
      customer {
        id
        hasAnyTag(tags: ["gwp_eligible"])
        metafield(namespace: "gwp", key: "eligible") { value }
      }
    }
  }
  discountNode {
    metafield(namespace: "$app:gwp-config", key: "function-configuration") { value }
  }
}
```

---

### 3.4 ★ `extensions/gwp-discount/src/run.js` — 核心 Function

**关键逻辑**：
1. 从 metafield 读配置（tiers / requireEligibility）
2. 用户资格校验（标签 or metafield）
3. 分离赠品行 vs 正价行（双重判断：产品标签 + 行属性 `_is_gift`）
4. 计算**仅正价商品**总额（防白嫖）
5. 从高到低匹配阶梯 → 得到 `giftAllowance`
6. 赠品按单价**升序**展开为单元
7. 逐个在额度内分配 100% off targets
8. 超出额度的赠品**不进 targets**（原价结算）

```javascript
const NO_DISCOUNT = { discountApplicationStrategy: "FIRST", discounts: [] };

export function run(input) {
  try {
    // 1. 解析配置
    const raw = input?.discountNode?.metafield?.value;
    if (!raw) return NO_DISCOUNT;
    let config;
    try { config = JSON.parse(raw); } catch { return NO_DISCOUNT; }
    const { tiers = [], requireEligibility = false, discountMessage = "Free Gift 🎁" } = config;
    if (!tiers.length) return NO_DISCOUNT;

    // 2. 用户资格
    if (requireEligibility) {
      const c = input?.cart?.buyerIdentity?.customer;
      if (!c) return NO_DISCOUNT;
      if (!c.hasAnyTag && c.metafield?.value !== "true") return NO_DISCOUNT;
    }

    // 3. 分离行
    const giftLines = [], regularLines = [];
    for (const line of input.cart.lines) {
      if (isGift(line)) giftLines.push(line);
      else regularLines.push(line);
    }
    if (!giftLines.length) return NO_DISCOUNT;

    // 4. 正价总额（⚠️ parseFloat，排除赠品）
    let regularTotal = 0;
    for (const l of regularLines) {
      const p = parseFloat(l.cost.amountPerQuantity.amount);
      if (!isNaN(p)) regularTotal += p * l.quantity;
    }

    // 5. 匹配阶梯（降序找第一个满足的）
    const sorted = [...tiers].sort((a, b) => b.threshold - a.threshold);
    let allowance = 0;
    for (const t of sorted) {
      if (regularTotal >= parseFloat(t.threshold)) { allowance = parseFloat(t.allowance); break; }
    }
    if (allowance <= 0) return NO_DISCOUNT;

    // 6. 展开赠品单元，按单价升序
    const units = [];
    for (const l of giftLines) {
      const p = parseFloat(l.cost.amountPerQuantity.amount);
      if (isNaN(p) || p <= 0) continue;
      for (let i = 0; i < l.quantity; i++) units.push({ lineId: l.id, unitPrice: p });
    }
    units.sort((a, b) => a.unitPrice - b.unitPrice);

    // 7. 在额度内分配
    let remaining = allowance;
    const map = {};
    for (const u of units) {
      if (u.unitPrice <= remaining + 0.001) {
        remaining -= u.unitPrice;
        if (remaining < 0) remaining = 0;
        map[u.lineId] = (map[u.lineId] || 0) + 1;
      }
    }

    // 8. 构建 targets
    const targets = Object.entries(map)
      .filter(([, q]) => q > 0)
      .map(([id, q]) => ({ cartLine: { id, quantity: q } }));
    if (!targets.length) return NO_DISCOUNT;

    return {
      discountApplicationStrategy: "FIRST",
      discounts: [{ targets, value: { percentage: { value: "100.0" } }, message: discountMessage }],
    };
  } catch { return NO_DISCOUNT; }
}

function isGift(line) {
  if (line.merchandise?.product?.hasAnyTag) return true;
  if (line.attribute?.value === "true") return true;
  return false;
}
```

---

### 3.5 `app/models/campaign.server.js`

**职责**：Campaign / Gift / EligibleUser 的 CRUD + 默认配置。

要实现的导出函数：

| 函数 | 说明 |
|------|------|
| `getCampaigns(shop)` | 列表（含 `_count`） |
| `getCampaign(id, shop)` | 详情（含 gifts + users） |
| `createCampaign(data)` | 创建（JSON.stringify tiers/styling/copywriting） |
| `updateCampaign(id, shop, data)` | 部分更新 |
| `deleteCampaign(id, shop)` | 删除 |
| `getActiveCampaign(shop)` | 查活跃且在时间范围内的活动 |
| `addGifts(campaignId, gifts[])` | `createMany` |
| `updateGift(id, data)` | 单个更新 |
| `deleteGift(id)` | 删除 |
| `incrementGiftUsage(variantId, qty)` | 出库+自动停用 |
| `addEligibleUsers(campaignId, emails[])` | `createMany` + skipDuplicates |
| `checkUserEligibility(shop, email)` | 查活跃活动中是否有该用户 |
| `deleteEligibleUser(id)` / `clearEligibleUsers(campaignId)` | 清理 |
| `getDefaultStyling()` | 返回默认颜色/圆角/卡片风格 |
| `getDefaultCopywriting()` | 返回所有文案字段的默认值 |

**默认 Styling**：
```json
{
  "primaryColor": "#FF6B35",
  "secondaryColor": "#FFF8F0",
  "accentColor": "#2D3436",
  "borderRadius": "12px",
  "cardStyle": "elevated",
  "progressBarColor": "#FF6B35",
  "badgeColor": "#FF6B35"
}
```

**默认 Copywriting**（至少包含）：
```json
{
  "landingTitle": "🎁 Free Gifts For You!",
  "landingSubtitle": "Spend more, earn more free gifts!",
  "cartWidgetTitle": "🎁 You've unlocked free gifts!",
  "cartWidgetCta": "Choose Your Free Gifts",
  "modalTitle": "Choose Your Free Gifts",
  "progressPrefix": "Spend",
  "progressSuffix": "more to unlock the next tier!",
  "emptyState": "Add items to your cart to unlock free gifts",
  "tierReachedText": "You've reached the maximum tier! 🎉",
  "addToCartText": "Add Gift",
  "removeText": "Remove",
  "soldOutText": "Sold Out",
  "allowanceLabel": "Gift Allowance",
  "remainingLabel": "Remaining"
}
```

---

### 3.6 `app/models/shopify-operations.server.js`

**职责**：通过 `admin.graphql()` 调用 Shopify Admin API。

要实现的导出函数：

| 函数 | GraphQL 操作 |
|------|-------------|
| `createAutomaticDiscount(admin, campaign, functionId)` | `discountAutomaticAppCreate`，metafield 写入 `{tiers, requireEligibility, discountMessage, giftTag}` |
| `updateAutomaticDiscount(admin, campaign)` | `discountAutomaticAppUpdate`，更新同上 metafield |
| `deleteAutomaticDiscount(admin, discountId)` | `discountAutomaticDelete` |
| `getDiscountFunctionId(admin)` | `shopifyFunctions(first:25)` 查 `apiType=product_discount` 且 title 含 "GWP" |
| `addProductTag(admin, productId, tag)` | `tagsAdd` |
| `removeProductTag(admin, productId, tag)` | `tagsRemove` |
| `addCustomerTag(admin, customerId, tag)` | `tagsAdd` |
| `findCustomerByEmail(admin, email)` | `customers(first:1, query:"email:xxx")` |
| `searchProducts(admin, query, first=20)` | `products(first, query)` 含 variants/images/tags |

**Metafield 规格**：
- namespace: `$app:gwp-config`
- key: `function-configuration`
- type: `json`

---

### 3.7 `app/routes/webhooks.jsx`

- `ORDERS_CREATE` → 遍历 `line_items`，若 `properties._is_gift === "true"` 或 tags 含 `is_free_gift`，调用 `incrementGiftUsage`
- `APP_UNINSTALLED` → 清理 session

---

### 3.8 `app/routes/api.gwp.$.jsx` — App Proxy API

**路由**: `/apps/gwp/campaign` | `/apps/gwp/gifts` | `/apps/gwp/eligibility`

| 路径 | 方法 | 逻辑 |
|------|------|------|
| `/campaign` | GET | 返回当前活跃活动（含 tiers/styling/copywriting，JSON.parse 后返回） |
| `/gifts?campaign_id=` | GET | 返回赠品列表，计算 `inStock` 和 `remaining` |
| `/eligibility?email=` | GET | 不需要资格 → `{eligible:true}`；需要 → 查 EligibleUser 表 |

**注意**：需验证 App Proxy 签名（HMAC SHA256），开发环境可跳过。

---

### 3.9 `app/routes/app.jsx` — Admin Layout

标准 Polaris `AppProvider` + `NavMenu`（Dashboard / New Campaign）。

---

### 3.10 `app/routes/app._index.jsx` — Dashboard

- Loader: `getCampaigns(session.shop)`
- Action: `delete` → 删除关联 Shopify Discount + 数据库记录
- UI: `IndexTable`，显示 title / status(Badge) / duration / tiers数 / gifts数 / users数
- EmptyState 引导创建
- 每行可编辑/删除

---

### 3.11 `app/routes/app.campaign.$id.jsx` — 创建/编辑活动

**Loader**：
- `id === "new"` → 返回空 + 默认配置
- 否则 → `getCampaign(id, shop)` + JSON.parse 各字段

**Action 类型**（通过 `formData.get("actionType")` 区分）：

| actionType | 逻辑 |
|---|---|
| `saveCampaign` | new → `createCampaign` + redirect；否则 `updateCampaign` |
| `activate` | `getDiscountFunctionId` → `createAutomaticDiscount`（或 update） → 给赠品产品 `addProductTag` → 给用户 `addCustomerTag("gwp_eligible")` → status="active" |
| `deactivate` | status="paused" |
| `addGifts` | `addGifts(id, JSON.parse(gifts))` |
| `deleteGift` | `deleteGift(giftId)` |
| `importUsers` | `addEligibleUsers(id, JSON.parse(emails))` |
| `deleteUser` / `clearUsers` | 对应操作 |
| `searchProducts` | `searchProducts(admin, query)` → 返回结果 |

**UI 结构（6 个 Tab）**：

| Tab | 内容 |
|-----|------|
| Basic Info | title, startTime, endTime, status(Select), requireEligibility(Checkbox), giftTag, discountMessage |
| Tiers | 动态增减行，每行 threshold + allowance，默认预填 7 档 |
| Gifts | 产品搜索弹窗 + CSV 批量导入 + DataTable 列表(image/title/price/limit/used/delete) |
| Users | 文本框输入邮箱 + CSV导入 + 列表展示 + 清空 |
| Styling | 颜色选择器(primary/secondary/accent/progressBar/badge) + borderRadius + cardStyle(Select) |
| Copy | 遍历 copywriting 对象所有 key 生成 TextField |

主要操作按钮：Save（primaryAction）+ Activate/Pause（secondaryAction）

---

### 3.12 `extensions/gwp-theme-ext/shopify.extension.toml`

```toml
api_version = "2026-01"

[[extensions]]
name = "GWP Theme Extension"
handle = "gwp-theme-ext"
type = "theme"

  [[extensions.blocks]]
  name = "GWP Landing Page"
  target = "section"
  template = "blocks/gwp-landing-page.liquid"

  [[extensions.blocks]]
  name = "GWP Cart Widget"
  target = "section"
  template = "blocks/gwp-cart-widget.liquid"
```

---

### 3.13 `extensions/gwp-theme-ext/assets/gwp-styles.css`

**CSS 变量体系**：
```
--gwp-primary / --gwp-secondary / --gwp-accent / --gwp-success / --gwp-danger
--gwp-gray-100~900 / --gwp-radius / --gwp-shadow / --gwp-transition
```

**需要覆盖的组件**：

| 组件 | 核心类名 | 要点 |
|------|---------|------|
| 落地页容器 | `.gwp-landing` | max-width 1200, 居中 |
| 阶梯卡片 | `.gwp-tier-card` / `.active` / `.reached` | flex 自适应，hover 上浮，顶部彩条 |
| 赠品网格 | `.gwp-gifts-grid` → `.gwp-gift-card` | CSS Grid auto-fill 220px，图片 1:1，hover 放大，FREE 徽章，Sold Out 蒙层 |
| 购物车 Widget | `.gwp-cart-widget` | 边框高亮，进度条渐变，已选赠品缩略图行 |
| 弹窗 | `.gwp-modal-overlay` / `.gwp-modal` | fixed 全屏遮罩，居中卡片，头部/信息栏/滚动体/底部栏 |
| 弹窗赠品卡 | `.gwp-mgift` / `.selected` / `.disabled` | 边框选中态，勾选角标动画，按钮切换 add/remove |
| 响应式 | `@media (max-width:768px)` | 标题缩小，网格 2 列，弹窗底部弹出 |
| 动画 | `.gwp-animate-in` / `.gwp-spinner` | fadeIn + translateY，旋转加载 |

---

### 3.14 `extensions/gwp-theme-ext/blocks/gwp-landing-page.liquid`

- 引入 `gwp-styles.css`
- `<div id="gwp-landing-root" data-proxy-base="/apps/gwp">`
- 骨架：header (title + subtitle) → tiers 容器（初始 loading spinner）→ gifts grid 容器
- 引入 `gwp-landing.js`
- Schema settings：show_tiers(checkbox), show_gifts(checkbox), max_gifts(range 4-24)

---

### 3.15 `extensions/gwp-theme-ext/assets/gwp-landing.js`

**逻辑流**：
1. `fetch(PROXY_BASE + "/campaign")` → 拿 campaign
2. 若无 campaign，隐藏组件
3. `applyCustomStyles(styling)` → 设 CSS 变量
4. `applyCopywriting(copy)` → 替换标题文本
5. `renderTiers(tiers)` → 升序排列，生成卡片 HTML（含动画延迟）
6. `fetch(PROXY_BASE + "/gifts?campaign_id=")` → 拿赠品
7. `renderGifts(gifts)` → 生成卡片（图/FREE 徽章/原价划线/库存提示/Sold Out 蒙层）

---

### 3.16 `extensions/gwp-theme-ext/blocks/gwp-cart-widget.liquid`

- 引入 `gwp-styles.css`
- Liquid 计算 `cart_total`（排除 `_is_gift` 行）
- `<div id="gwp-cart-root" data-proxy-base="/apps/gwp" data-cart-total="{{ cart_total | divided_by: 100.0 }}" data-customer-email="{{ customer.email }}">`
- 骨架：widget(header + progress bar + selected gifts + CTA button) + modal overlay(header/info-bar/grid/footer)
- 引入 `gwp-cart.js`
- Schema settings：enable(checkbox), show_progress(checkbox)

---

### 3.17 ★ `extensions/gwp-theme-ext/assets/gwp-cart.js` — 核心前端

**状态变量**：campaign, gifts[], selectedGiftVariantIds(Set), currentAllowance, regularTotal, tiers[], copywriting

**Init 流程**：
1. `fetch("/apps/gwp/campaign")` → 存 campaign, tiers, copywriting
2. 若 `requireEligibility`，`fetch("/apps/gwp/eligibility?email=")` → 不合格则隐藏
3. `applyStyles()` / `applyCopy()`
4. `fetch("/apps/gwp/gifts?campaign_id=")` → 存 gifts
5. `refreshCartState()` → 首次刷新
6. `bindEvents()`

**refreshCartState()**：
1. `fetch("/cart.js")` → 遍历 items
2. 分离赠品（`_is_gift=true` 或 tag 含 `is_free_gift`）→ 记入 `selectedGiftVariantIds`
3. 其余累加 `regularTotal`（⚠️ `final_line_price / 100`）
4. `matchTier()` → 找当前和下一阶梯
5. `updateWidget()` / `updateSelectedGiftsDisplay()`

**matchTier()**：降序找第一个 `regularTotal >= threshold` → `currentAllowance`；升序找第一个 `threshold > regularTotal` → `nextTier`

**updateWidget()**：
- 有 nextTier → 进度条 `(regularTotal/nextThreshold)*100`%，显示差额
- 最高阶梯 → 100%，完成文案
- 无阶梯 → 显示到第一档的进度
- CTA 按钮启用/禁用

**openModal() → renderModalGifts()**：
- 计算已选总价 `calcSelectedTotal()`
- `remaining = allowance - selectedTotal`
- 渲染每个 gift 卡片：判断 isSelected / canAfford(`price <= remaining+0.01`) / isSoldOut
- 按钮文案：已选→"Remove"，售罄→"Sold Out"，买不起→disabled
- 绑定 click → `addGiftToCart` 或 `removeGiftFromCart`

**addGiftToCart(variantId)**：
```javascript
fetch("/cart/add.js", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ items: [{
    id: parseInt(numericVariantId),
    quantity: 1,
    properties: { _is_gift: "true", _gwp_campaign: campaign.id }
  }] })
})
```
→ 更新 Set → refreshCartState → renderModalGifts → dispatchCartUpdate

**removeGiftFromCart(variantId)**：
- `fetch("/cart.js")` 找到匹配的 line item key
- `fetch("/cart/change.js", { id: key, quantity: 0 })`
- → 同上刷新

**bindEvents()**：CTA→openModal，close/done/overlay click/ESC→closeModal，`cart:updated` 事件→延迟 refresh

---

### 3.18 `shopify.app.toml`

```toml
name = "GWP - Gift With Purchase"
client_id = "替换"
application_url = "https://替换.onrender.com"
embedded = true

[access_scopes]
scopes = "write_products,read_products,write_customers,read_customers,write_discounts,read_discounts"

[auth]
redirect_urls = ["https://替换.onrender.com/auth/callback","https://替换.onrender.com/auth/shopify/callback","https://替换.onrender.com/api/auth/callback"]

[webhooks]
api_version = "2026-01"
  [[webhooks.subscriptions]]
  topics = ["orders/create"]
  uri = "/webhooks"
  [[webhooks.subscriptions]]
  topics = ["app/uninstalled"]
  uri = "/webhooks"

[app_proxy]
url = "https://替换.onrender.com/api/gwp"
subpath = "gwp"
prefix = "apps"

[pos]
embedded = false
```

---

### 3.19 `package.json` scripts

```json
{
  "scripts": {
    "build": "remix vite:build",
    "dev": "shopify app dev",
    "docker-start": "npx prisma migrate deploy && remix-serve ./build/server/index.js",
    "start": "remix-serve ./build/server/index.js"
  }
}
```

---

## 四、部署流程

```
1. Git push 到仓库
2. Render: New Web Service → 连接仓库
   - Build: npm install && npx prisma generate && npm run build
   - Start: npx prisma migrate deploy && npm start
   - 环境变量: SHOPIFY_API_KEY, SHOPIFY_API_SECRET, HOST, DATABASE_URL, NODE_ENV=production
   - 挂载磁盘 /data (SQLite 持久化)
3. 回填 shopify.app.toml 中的 client_id + 域名
4. 本地执行: shopify app deploy (推送 Function + Theme Extension)
5. Shopify Admin → Apps → 安装 → 创建活动 → 激活
6. 主题编辑器 → 添加 GWP Landing Page section + GWP Cart Widget section
```

---

## 五、验证清单

```
□ 管理后台能创建/编辑/激活活动
□ Shopify Discounts 中出现自动折扣
□ 赠品产品被打上 is_free_gift 标签
□ 落地页正常展示阶梯 + 赠品
□ 购物车 widget 显示进度条
□ 正价商品满额后 CTA 可点击
□ 弹窗内赠品可选择/移除
□ 赠品在额度内显示 100% off
□ 移除正价商品使总额低于阈值 → 赠品恢复原价
□ 赠品金额不计入阈值判断（移除一个正价商品测试）
□ 高价赠品不会挤占低价赠品的额度
□ 库存为 0 的赠品显示 Sold Out 且不可选
□ 下单后赠品 inventoryUsed 递增
□ requireEligibility 开启时非名单用户不可见组件
```