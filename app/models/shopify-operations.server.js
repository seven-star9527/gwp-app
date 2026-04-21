// app/models/shopify-operations.server.js

// ─── Discount Operations ─────────────────────────────────────────────────────

export async function createAutomaticDiscount(admin, campaign, functionId) {
  const config = buildMetafieldConfig(campaign);

  const response = await admin.graphql(
    `#graphql
    mutation CreateAutomaticDiscount($discount: DiscountAutomaticAppInput!) {
      discountAutomaticAppCreate(automaticAppDiscount: $discount) {
        automaticAppDiscount {
          discountId
        }
        userErrors {
          field
          message
        }
      }
    }`,
    {
      variables: {
        discount: {
          title: campaign.title,
          functionId,
          startsAt: campaign.startTime,
          endsAt: campaign.endTime,
          metafields: [
            {
              namespace: "$app:gwp-config",
              key: "function-configuration",
              type: "json",
              value: JSON.stringify(config),
            },
          ],
        },
      },
    }
  );

  const json = await response.json();
  const errors = json.data?.discountAutomaticAppCreate?.userErrors;
  if (errors?.length) {
    throw new Error(errors.map((e) => e.message).join(", "));
  }
  return json.data?.discountAutomaticAppCreate?.automaticAppDiscount;
}

export async function updateAutomaticDiscount(admin, campaign) {
  if (!campaign.discountId) throw new Error("No discountId on campaign");
  const config = buildMetafieldConfig(campaign);

  const response = await admin.graphql(
    `#graphql
    mutation UpdateAutomaticDiscount($id: ID!, $discount: DiscountAutomaticAppInput!) {
      discountAutomaticAppUpdate(id: $id, automaticAppDiscount: $discount) {
        automaticAppDiscount {
          discountId
        }
        userErrors {
          field
          message
        }
      }
    }`,
    {
      variables: {
        id: campaign.discountId,
        discount: {
          title: campaign.title,
          startsAt: campaign.startTime,
          endsAt: campaign.endTime,
          metafields: [
            {
              namespace: "$app:gwp-config",
              key: "function-configuration",
              type: "json",
              value: JSON.stringify(config),
            },
          ],
        },
      },
    }
  );

  const json = await response.json();
  const errors = json.data?.discountAutomaticAppUpdate?.userErrors;
  if (errors?.length) {
    throw new Error(errors.map((e) => e.message).join(", "));
  }
  return json.data?.discountAutomaticAppUpdate?.automaticAppDiscount;
}

export async function deleteAutomaticDiscount(admin, discountId) {
  const response = await admin.graphql(
    `#graphql
    mutation DeleteDiscount($id: ID!) {
      discountAutomaticDelete(id: $id) {
        deletedAutomaticDiscountId
        userErrors {
          field
          message
        }
      }
    }`,
    { variables: { id: discountId } }
  );

  const json = await response.json();
  return json.data?.discountAutomaticDelete;
}

export async function getDiscountFunctionId(admin) {
  const response = await admin.graphql(
    `#graphql
    query GetFunctions {
      shopifyFunctions(first: 25) {
        nodes {
          id
          title
          apiType
        }
      }
    }`
  );

  const json = await response.json();
  const functions = json.data?.shopifyFunctions?.nodes ?? [];
  const fn = functions.find(
    (f) =>
      f.apiType === "product_discount" &&
      f.title.toLowerCase().includes("gwp")
  );
  return fn?.id ?? null;
}

// ─── Product & Customer Tag Operations ──────────────────────────────────────

export async function addProductTag(admin, productId, tag) {
  const response = await admin.graphql(
    `#graphql
    mutation AddTag($id: ID!, $tags: [String!]!) {
      tagsAdd(id: $id, tags: $tags) {
        node { id }
        userErrors { field message }
      }
    }`,
    { variables: { id: productId, tags: [tag] } }
  );
  const json = await response.json();
  return json.data?.tagsAdd;
}

export async function removeProductTag(admin, productId, tag) {
  const response = await admin.graphql(
    `#graphql
    mutation RemoveTag($id: ID!, $tags: [String!]!) {
      tagsRemove(id: $id, tags: $tags) {
        node { id }
        userErrors { field message }
      }
    }`,
    { variables: { id: productId, tags: [tag] } }
  );
  const json = await response.json();
  return json.data?.tagsRemove;
}

export async function addCustomerTag(admin, customerId, tag) {
  const response = await admin.graphql(
    `#graphql
    mutation AddCustomerTag($id: ID!, $tags: [String!]!) {
      tagsAdd(id: $id, tags: $tags) {
        node { id }
        userErrors { field message }
      }
    }`,
    { variables: { id: customerId, tags: [tag] } }
  );
  const json = await response.json();
  return json.data?.tagsAdd;
}

export async function findCustomerByEmail(admin, email) {
  const response = await admin.graphql(
    `#graphql
    query FindCustomer($query: String!) {
      customers(first: 1, query: $query) {
        nodes {
          id
          email
          firstName
          lastName
        }
      }
    }`,
    { variables: { query: `email:${email}` } }
  );
  const json = await response.json();
  return json.data?.customers?.nodes?.[0] ?? null;
}

export async function searchProducts(admin, query, first = 20) {
  const response = await admin.graphql(
    `#graphql
    query SearchProducts($query: String!, $first: Int!) {
      products(first: $first, query: $query) {
        nodes {
          id
          title
          handle
          tags
          variants(first: 10) {
            nodes {
              id
              title
              price
              compareAtPrice
              inventoryQuantity
            }
          }
          images(first: 1) {
            nodes {
              url
              altText
            }
          }
        }
      }
    }`,
    { variables: { query, first } }
  );
  const json = await response.json();
  return json.data?.products?.nodes ?? [];
}

// ─── Internal Helper ─────────────────────────────────────────────────────────

function buildMetafieldConfig(campaign) {
  const tiers =
    typeof campaign.tiers === "string"
      ? JSON.parse(campaign.tiers)
      : campaign.tiers ?? [];
  return {
    tiers,
    requireEligibility: campaign.requireEligibility ?? false,
    discountMessage: campaign.discountMessage ?? "Free Gift 🎁",
    giftTag: campaign.giftTag ?? "is_free_gift",
  };
}
