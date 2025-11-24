'use server';

import { shopifyApi, LATEST_API_VERSION, Session } from '@shopify/shopify-api';
import '@shopify/shopify-api/adapters/node';
import { Product, ShopifyProductImage } from '@/lib/types';
import { Readable, Writable } from 'stream';
import { createReadStream } from 'fs';
import { S_IFREG } from 'constants';
import { request } from 'http';

// --- Helper Types for API Responses ---
interface ShopifyGraphQLError {
  message: string;
  locations: { line: number; column: number }[];
  path: string[];
  extensions: {
    code: string;
    documentation: string;
  };
}

interface GraphQLResponse<T> {
  body: {
    data: T;
    errors?: ShopifyGraphQLError[];
    extensions: {
      cost: {
        requestedQueryCost: number;
        actualQueryCost: number;
        throttleStatus: {
          maximumAvailable: number;
          currentlyAvailable: number;
          restoreRate: number;
        };
      };
    };
  };
}

interface ShopifyRestError {
  errors: string | { [key: string]: string | string[] };
}

interface RestResponse<T> {
  body: T & ShopifyRestError;
  headers: Record<string, string | string[] | undefined>;
}

// --- Strict Shopify Types ---
interface ShopifyRestImage {
  id: number;
  product_id: number;
  position: number;
  created_at: string;
  updated_at: string;
  alt: string | null;
  width: number;
  height: number;
  src: string;
  variant_ids: number[];
}

interface ShopifyRestVariant {
  id: number;
  product_id: number;
  title: string;
  price: string;
  sku: string;
  position: number;
  inventory_policy: string;
  compare_at_price: string | null;
  fulfillment_service: string;
  inventory_management: string | null;
  option1: string | null;
  option2: string | null;
  option3: string | null;
  created_at: string;
  updated_at: string;
  taxable: boolean;
  barcode: string | null;
  grams: number;
  image_id: number | null;
  weight: number;
  weight_unit: string;
  inventory_item_id: number;
  inventory_quantity: number;
  old_inventory_quantity: number;
  requires_shipping: boolean;
}

interface ShopifyRestProduct {
  id: number;
  title: string;
  body_html: string | null;
  vendor: string;
  product_type: string;
  created_at: string;
  handle: string;
  updated_at: string;
  published_at: string | null;
  template_suffix: string | null;
  status: string;
  published_scope: string;
  tags: string;
  admin_graphql_api_id: string;
  variants: ShopifyRestVariant[];
  options: { id: number; product_id: number; name: string; position: number; values: string[] }[];
  images: ShopifyRestImage[];
  image: ShopifyRestImage | null;
}

interface ShopifyGraphqlVariant {
  id: string;
  sku: string;
  price: string;
  inventoryQuantity: number;
  inventoryItem: {
    id: string;
    measurement: {
      weight: {
        value: number;
        unit: string;
      };
    };
  };
  image: {
    id: string;
  };
}

interface ShopifyGraphqlProduct {
  id: string;
  title: string;
  handle: string;
  bodyHtml: string;
  templateSuffix: string | null;
  tags: string[];
  priceRange: {
    minVariantPrice: {
      amount: string;
    };
  };
  featuredImage: {
    url: string;
  } | null;
  variants: {
    edges: {
      node: ShopifyGraphqlVariant;
    }[];
    pageInfo: {
      hasNextPage: boolean;
      endCursor: string;
    };
  };
}

// --- Helper function to introduce a delay ---
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function retryOperation<T>(operation: () => Promise<T>, maxRetries: number = 8): Promise<T> {
  let retries = 0;
  while (true) {
    try {
      return await operation();
    } catch (error: any) {
      const errorString = JSON.stringify(error);
      const isThrottled =
        errorString.includes('Throttled') ||
        errorString.includes('Exceeded 2 calls per second') ||
        (error.response && error.response.statusCode === 429);

      if (isThrottled && retries < maxRetries) {
        const delay = 1000 * Math.pow(2, retries);
        console.log(`Rate limited. Retrying in ${delay}ms... (Attempt ${retries + 1}/${maxRetries})`);
        await sleep(delay);
        retries++;
      } else {
        throw error;
      }
    }
  }
}

const GAMMA_WAREHOUSE_LOCATION_ID = process.env.GAMMA_WAREHOUSE_LOCATION_ID
  ? parseInt(process.env.GAMMA_WAREHOUSE_LOCATION_ID, 10)
  : 93998154045;

// --- GraphQL Queries & Mutations ---

const GET_VARIANTS_BY_SKU_QUERY = `
  query getVariantsBySku($query: String!) {
    productVariants(first: 250, query: $query) {
      edges {
        node {
          id
          sku
          price
          inventoryQuantity
          inventoryItem {
            id
            measurement {
              weight {
                value
                unit
              }
            }
            inventoryLevels(first: 5) {
              edges {
                node {
                  location {
                    id
                  }
                }
              }
            }
          }
          image {
            id
          }
          product {
            id
            title
            handle
            bodyHtml
            templateSuffix
            tags
            featuredImage {
              url
            }
          }
        }
      }
    }
  }
`;

const GET_PRODUCT_BY_HANDLE_QUERY = `
  query getProductByHandle($handle: String!) {
    productByHandle(handle: $handle) {
      id
      handle
      images(first: 100) {
        edges {
            node {
                id
                url
            }
        }
      }
    }
  }
`;

const GET_COLLECTION_BY_TITLE_QUERY = `
  query getCollectionByTitle($query: String!) {
    collections(first: 1, query: $query) {
      edges {
        node {
          id
        }
      }
    }
  }
`;

const GET_ALL_PUBLICATIONS_QUERY = `
  query getPublications {
    publications(first: 50) {
      edges {
        node {
          id
          name
        }
      }
    }
  }
`;

const PUBLISHABLE_PUBLISH_MUTATION = `
  mutation publishablePublish($id: ID!, $input: [PublicationInput!]!) {
    publishablePublish(id: $id, input: $input) {
      publishable {
        ... on Product {
          availablePublicationsCount {
            count
          }
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const UPDATE_PRODUCT_MUTATION = `
    mutation productUpdate($input: ProductInput!) {
        productUpdate(input: $input) {
            product {
                id
            }
            userErrors {
                field
                message
            }
        }
    }
`;

const BULK_OPERATION_RUN_QUERY_MUTATION = `
  mutation bulkOperationRunQuery($query: String!) {
    bulkOperationRunQuery(query: $query) {
      bulkOperation {
        id
        status
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const GET_CURRENT_BULK_OPERATION_QUERY = `
  query {
    currentBulkOperation {
      id
      status
      errorCode
      createdAt
      completedAt
      objectCount
      fileSize
      url
    }
  }
`;

const ADD_TAGS_MUTATION = `
  mutation tagsAdd($id: ID!, $tags: [String!]!) {
    tagsAdd(id: $id, tags: $tags) {
      node {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const REMOVE_TAGS_MUTATION = `
  mutation tagsRemove($id: ID!, $tags: [String!]!) {
    tagsRemove(id: $id, tags: $tags) {
      node {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const INVENTORY_SET_QUANTITIES_MUTATION = `
    mutation inventorySetQuantities($input: InventorySetQuantitiesInput!) {
        inventorySetQuantities(input: $input) {
            inventoryAdjustmentGroup {
                id
            }
            userErrors {
                field
                message
                code
            }
        }
    }
`;

// --- Client Initialization ---

function getShopifyGraphQLClient() {
  if (!process.env.SHOPIFY_SHOP_NAME || !process.env.SHOPIFY_API_ACCESS_TOKEN) {
    console.error('Shopify environment variables are not set.');
    throw new Error('Shopify environment variables are not set. Please create a .env.local file.');
  }

  const shopify = shopifyApi({
    apiKey: 'dummy',
    apiSecretKey: 'dummy',
    scopes: [
      'read_products',
      'write_products',
      'read_inventory',
      'write_inventory',
      'read_locations',
    ],
    hostName: 'dummy.ngrok.io',
    apiVersion: LATEST_API_VERSION,
    isEmbeddedApp: false,
    maxRetries: 3,
  });

  const session = new Session({
    id: 'offline_' + process.env.SHOPIFY_SHOP_NAME,
    shop: process.env.SHOPIFY_SHOP_NAME!,
    accessToken: process.env.SHOPIFY_API_ACCESS_TOKEN!,
    isOnline: false,
    state: 'state',
  });

  return new shopify.clients.Graphql({ session });
}

function getShopifyRestClient() {
  if (!process.env.SHOPIFY_SHOP_NAME || !process.env.SHOPIFY_API_ACCESS_TOKEN) {
    console.error('Shopify environment variables are not set.');
    throw new Error('Shopify environment variables are not set. Please create a .env.local file.');
  }

  const shopify = shopifyApi({
    apiKey: 'dummy',
    apiSecretKey: 'dummy',
    scopes: [
      'read_products',
      'write_products',
      'read_inventory',
      'write_inventory',
      'read_locations',
    ],
    hostName: 'dummy.ngrok.io',
    apiVersion: LATEST_API_VERSION,
    isEmbeddedApp: false,
    maxRetries: 3,
  });

  const session = new Session({
    id: 'offline_' + process.env.SHOPIFY_SHOP_NAME,
    shop: process.env.SHOPIFY_SHOP_NAME!,
    accessToken: process.env.SHOPIFY_API_ACCESS_TOKEN!,
    isOnline: false,
    state: 'state',
  });

  return new shopify.clients.Rest({ session, apiVersion: LATEST_API_VERSION });
}

// --- Data Fetching Functions ---

const convertWeightToGrams = (
  weight: number | null | undefined,
  unit: string | null | undefined
): number | null => {
  if (weight === null || weight === undefined) return null;
  const upperUnit = unit?.toUpperCase();
  if (upperUnit === 'G' || upperUnit === 'GRAMS') return weight;
  if (upperUnit === 'KG' || upperUnit === 'KILOGRAMS') return weight * 1000;
  if (upperUnit === 'LB' || upperUnit === 'POUNDS') return weight * 453.592;
  if (upperUnit === 'OZ' || upperUnit === 'OUNCES') return weight * 28.3495;
  return weight; // Default to returning the value if unit is unknown or missing
};

export async function getShopifyProductsBySku(skus: string[]): Promise<Product[]> {
  console.log(`Starting to fetch ${skus.length} products from Shopify by SKU.`);
  const shopifyClient = getShopifyGraphQLClient();

  const allProducts: Product[] = [];
  const requestedSkuSet = new Set(skus);

  const skuBatches: string[][] = [];
  for (let i = 0; i < skus.length; i += 10) {
    skuBatches.push(skus.slice(i, i + 10));
  }

  console.log(`Processing ${skuBatches.length} batches of SKUs.`);

  const processBatch = async (batch: string[]) => {
    // Escape quotes in SKUs to prevent query syntax errors
    const query = batch.map((sku) => `sku:"${sku.replace(/"/g, '\\"')}"`).join(' OR ');

    let retries = 0;
    let success = false;
    const batchProducts: Product[] = [];

    while (retries < 5 && !success) {
      try {
        // Dynamic sleep based on retries to back off
        if (retries > 0) {
          await sleep(1000 * Math.pow(2, retries));
        } else {
          // Small initial delay to spread out requests slightly
          await sleep(200);
        }

        const response = (await shopifyClient.query({
          data: {
            query: GET_VARIANTS_BY_SKU_QUERY,
            variables: { query },
          },
        })) as GraphQLResponse<{ productVariants: { edges: { node: any }[] } }>;

        const responseErrors = response.body.errors;
        if (responseErrors) {
          const errorString = JSON.stringify(responseErrors);
          // console.error('GraphQL Errors:', errorString); // Reduce noise

          if (errorString.includes('Throttled')) {
            console.log(
              `Throttled by Shopify on batch, backing off... (Attempt ${retries + 1})`
            );
            retries++;
            continue; // Retry
          }
          // For non-throttling errors, throw to fail the entire operation.
          throw new Error(`Non-recoverable GraphQL error: ${errorString}`);
        }

        const variantEdges = response.body.data?.productVariants?.edges || [];

        if (batch.includes('420-8417')) {
          console.log(`DEBUG: Found ${variantEdges.length} variants in batch containing 420-8417.`);
          const found = variantEdges.find(e => e.node.sku === '420-8417');
          if (found) {
            console.log('DEBUG: Successfully found 420-8417 in response!');
          } else {
            console.log('DEBUG: 420-8417 NOT found in response.');
          }
        }

        for (const edge of variantEdges) {
          const variant = edge.node;
          const product = variant.product;

          if (variant && variant.sku && product) {
            batchProducts.push({
              id: product.id,
              variantId: variant.id,
              inventoryItemId: variant.inventoryItem?.id,
              handle: product.handle,
              sku: variant.sku,
              name: product.title,
              price: parseFloat(variant.price),
              inventory: variant.inventoryQuantity,
              descriptionHtml: product.bodyHtml,
              productType: null,
              vendor: null,
              tags: product.tags.join(', '),
              compareAtPrice: null,
              costPerItem: null,
              barcode: null,
              weight: convertWeightToGrams(
                variant.inventoryItem?.measurement?.weight?.value,
                variant.inventoryItem?.measurement?.weight?.unit
              ),
              mediaUrl: product.featuredImage?.url || null,
              imageId: variant.image?.id
                ? parseInt(variant.image.id.split('/').pop() || '0', 10)
                : null,
              category: null,
              option1Name: null,
              option1Value: null,
              option2Name: null,
              option2Value: null,
              option3Name: null,
              option3Value: null,
              templateSuffix: product.templateSuffix,
              locationIds: variant.inventoryItem?.inventoryLevels?.edges?.map(
                (edge: any) => edge.node.location.id
              ) || [],
            });
          }
        }
        success = true;
      } catch (error) {
        if (error instanceof Error && error.message.includes('Throttled')) {
          console.log(
            `Caught throttled error, backing off... (Attempt ${retries + 1})`
          );
          retries++;
        } else {
          console.error('An unexpected error occurred while fetching a batch. Aborting.', error);
          throw error;
        }
      }
    }
    if (!success) {
      throw new Error(`Failed to fetch batch after ${retries} retries. Aborting audit.`);
    }
    return batchProducts;
  };

  // Concurrency Control
  const CONCURRENCY_LIMIT = 20;
  const queue = [...skuBatches];

  const worker = async () => {
    while (queue.length > 0) {
      const batch = queue.shift();
      if (batch) {
        const results = await processBatch(batch);
        allProducts.push(...results);
      }
    }
  };

  const workers = Array(Math.min(skuBatches.length, CONCURRENCY_LIMIT)).fill(null).map(worker);
  await Promise.all(workers);

  // Case-insensitive matching with trimming
  const requestedSkuSetLower = new Set(Array.from(requestedSkuSet).map(s => s.trim().toLowerCase()));
  const exactMatchProducts = allProducts.filter((p) => requestedSkuSetLower.has(p.sku.trim().toLowerCase()));

  // --- Verification Step for Missing Products ---
  const foundSkusLower = new Set(exactMatchProducts.map((p) => p.sku.trim().toLowerCase()));
  const missingSkus = Array.from(requestedSkuSet).filter(
    (sku) => !foundSkusLower.has(sku.trim().toLowerCase())
  );

  if (missingSkus.length > 0) {
    console.log(`Verification: ${missingSkus.length} SKUs not found in batch search. Verifying individually...`);

    // Helper for single SKU verification
    const verifySku = async (sku: string) => {
      try {
        // Use a precise query for the single SKU
        const query = `sku:"${sku.replace(/"/g, '\\"')}"`;
        const response = (await shopifyClient.query({
          data: {
            query: GET_VARIANTS_BY_SKU_QUERY,
            variables: { query },
          },
        })) as GraphQLResponse<{ productVariants: { edges: { node: any }[] } }>;

        const edges = response.body.data?.productVariants?.edges || [];
        // Strict check: must match exactly
        const match = edges.find(e => e.node.sku.trim().toLowerCase() === sku.trim().toLowerCase());

        if (match) {
          console.log(`Verification: SKU '${sku}' found on second pass!`);
          return match.node;
        } else {
          // console.log(`Verification: SKU '${sku}' confirmed missing.`);
          return null;
        }
      } catch (error) {
        console.error(`Verification failed for SKU '${sku}':`, error);
        return null;
      }
    };

    // Run verification in parallel with limits
    const VERIFY_CONCURRENCY = 10;
    const verifyQueue = [...missingSkus];
    const verifiedProducts: Product[] = [];

    const verifyWorker = async () => {
      while (verifyQueue.length > 0) {
        const sku = verifyQueue.shift();
        if (sku) {
          await sleep(250); // Gentle rate limit for verification
          const node = await verifySku(sku);
          if (node) {
            // Map the node to Product type (reuse logic from processBatch if possible, or duplicate mapping here)
            // For simplicity/safety, duplicating the mapping to ensure it matches exactly
            const product = node.product;
            verifiedProducts.push({
              id: product.id,
              variantId: node.id,
              inventoryItemId: node.inventoryItem?.id,
              handle: product.handle,
              sku: node.sku,
              name: product.title,
              price: parseFloat(node.price),
              inventory: node.inventoryQuantity,
              descriptionHtml: product.bodyHtml,
              productType: null,
              vendor: null,
              tags: product.tags.join(', '),
              compareAtPrice: null,
              costPerItem: null,
              barcode: null,
              weight: convertWeightToGrams(
                node.inventoryItem?.measurement?.weight?.value,
                node.inventoryItem?.measurement?.weight?.unit
              ),
              mediaUrl: product.featuredImage?.url || null,
              imageId: node.image?.id
                ? parseInt(node.image.id.split('/').pop() || '0', 10)
                : null,
              category: null,
              option1Name: null,
              option1Value: null,
              option2Name: null,
              option2Value: null,
              option3Name: null,
              option3Value: null,
              templateSuffix: product.templateSuffix,
            });
          }
        }
      }
    };

    const verifyWorkers = Array(Math.min(missingSkus.length, VERIFY_CONCURRENCY)).fill(null).map(verifyWorker);
    await Promise.all(verifyWorkers);

    if (verifiedProducts.length > 0) {
      console.log(`Verification recovered ${verifiedProducts.length} products that were initially missed.`);
      exactMatchProducts.push(...verifiedProducts);
    }
  }

  console.log(
    `Finished fetching. Found ${allProducts.length} potential matches, ${exactMatchProducts.length} exact matches.`
  );
  return exactMatchProducts;
}

export async function getShopifyLocations(): Promise<{ id: number; name: string }[]> {
  const shopifyClient = getShopifyRestClient();
  try {
    const response = (await shopifyClient.get({ path: 'locations' })) as RestResponse<{
      locations: { id: number; name: string }[];
    }>;
    return response.body.locations;
  } catch (error: unknown) {
    const err = error as any;
    console.error('Error fetching Shopify locations:', err.response?.body || err);
    throw new Error(
      `Failed to fetch locations: ${JSON.stringify(err.response?.body?.errors || err.message)}`
    );
  }
}

export async function getProductByHandle(handle: string): Promise<any> {
  const shopifyClient = getShopifyGraphQLClient();
  try {
    const response = (await shopifyClient.query({
      data: {
        query: GET_PRODUCT_BY_HANDLE_QUERY,
        variables: { handle },
      },
    })) as GraphQLResponse<{ productByHandle: any }>;
    return response.body.data?.productByHandle;
  } catch (error) {
    console.error(`Error fetching product by handle "${handle}":`, error);
    return null;
  }
}

// --- Data Mutation Functions ---

export async function createProduct(
  productVariants: Product[],
  addClearanceTag: boolean
): Promise<ShopifyRestProduct> {
  const shopifyClient = getShopifyRestClient();

  const firstVariant = productVariants[0];
  const sanitizedDescription = firstVariant.descriptionHtml
    ? firstVariant.descriptionHtml.replace(/<h1/gi, '<h2').replace(/<\/h1>/gi, '</h2>')
    : '';

  const isSingleDefaultVariant =
    productVariants.length === 1 &&
    firstVariant.option1Name === 'Title' &&
    firstVariant.option1Value === 'Default Title';

  const getOptionValue = (value: string | null | undefined, fallback: string | null) =>
    value?.trim() ? value.trim() : fallback;

  // Create a mutable copy for processing
  const processedVariants = structuredClone(productVariants);
  const seenOptionValues = new Set<string>();

  for (const variant of processedVariants) {
    const optionKey = [variant.option1Value, variant.option2Value, variant.option3Value]
      .filter(Boolean)
      .join('/');
    if (seenOptionValues.has(optionKey) && optionKey && optionKey !== 'Default Title') {
      console.log(`Duplicate option values found for "${optionKey}". Uniquifying with SKU.`);
      // Make just one of the options unique enough
      if (variant.option1Value) {
        variant.option1Value = `${variant.option1Value} (${variant.sku})`;
      }
    }
    if (optionKey) {
      seenOptionValues.add(optionKey);
    }
  }

  const optionNames: string[] = [];
  if (firstVariant.option1Name && !isSingleDefaultVariant)
    optionNames.push(firstVariant.option1Name);
  if (firstVariant.option2Name) optionNames.push(firstVariant.option2Name);
  if (firstVariant.option3Name) optionNames.push(firstVariant.option3Name);

  const restOptions = optionNames.length > 0 ? optionNames.map((name) => ({ name })) : [];

  const restVariants = processedVariants.map((p: Product) => {
    const variantPayload: any = {
      price: p.price,
      sku: p.sku,
      barcode: p.barcode,
      compare_at_price: p.compareAtPrice,
      inventory_management: 'shopify',
      inventory_policy: 'deny',
      requires_shipping: true,
      weight: p.weight,
      weight_unit: 'g',
      cost: p.costPerItem,
    };

    if (!isSingleDefaultVariant) {
      if (p.option1Name) variantPayload.option1 = getOptionValue(p.option1Value, p.sku);
      if (p.option2Name) variantPayload.option2 = getOptionValue(p.option2Value, null);
      if (p.option3Name) variantPayload.option3 = getOptionValue(p.option3Value, null);
    }

    return variantPayload;
  });

  const uniqueImageUrls = [
    ...new Set(processedVariants.map((p: Product) => p.mediaUrl).filter(Boolean) as string[]),
  ];
  const restImages = uniqueImageUrls.map((url) => ({ src: url }));

  let tags = firstVariant.tags || '';

  // Limit to first 3 tags to prevent "cannot be more than 250" error
  if (tags) {
    const tagList = tags.split(',').map(t => t.trim()).filter(Boolean);
    if (tagList.length > 3) {
      tags = tagList.slice(0, 3).join(', ');
    }
  }

  if (addClearanceTag && !tags.toLowerCase().includes('clearance')) {
    tags = tags ? `Clearance, ${tags}` : 'Clearance';
  }

  const productPayload: { product: any } = {
    product: {
      title: firstVariant.name,
      handle: firstVariant.handle,
      body_html: sanitizedDescription,
      vendor: firstVariant.vendor,
      product_type: firstVariant.productType,
      status: 'active',
      tags: tags,
      variants: restVariants,
      images: restImages,
    },
  };

  if (restOptions.length > 0) {
    productPayload.product.options = restOptions;
  }

  const isHeavy = productVariants.some((p) => p.weight && p.weight > 22679.6);

  if (addClearanceTag) {
    productPayload.product.template_suffix = 'clearance';
    console.log(`Product ${firstVariant.handle} is from clearance file, assigning 'clearance' template.`);
  } else if (isHeavy) {
    productPayload.product.template_suffix = 'heavy-products';
    console.log(
      `Product ${firstVariant.handle} is over 50lbs, assigning 'heavy-products' template.`
    );
  }

  console.log(
    'Phase 1: Creating product with REST payload:',
    JSON.stringify(productPayload, null, 2)
  );

  try {
    const response = await retryOperation(async () => {
      return (await shopifyClient.post({
        path: 'products',
        data: productPayload,
      })) as RestResponse<{ product: any }>;
    });

    const createdProduct = response.body.product;

    if (!createdProduct || !createdProduct.variants) {
      console.error('Incomplete REST creation response:', response.body);
      throw new Error('Product creation did not return the expected product data.');
    }

    console.log('Phase 1: Product created successfully.');
    return createdProduct;
  } catch (error: any) {
    console.error('Error creating product via REST:', error.response?.body || error);
    throw new Error(
      `Failed to create product. Status: ${error.response?.statusCode} Body: ${JSON.stringify(error.response?.body)}`
    );
  }
}

export async function addProductVariant(product: Product): Promise<any> {
  const shopifyClient = getShopifyRestClient();
  const graphQLClient = getShopifyGraphQLClient();

  // Find the parent product's ID using its handle
  const productResponse = (await graphQLClient.query({
    data: {
      query: GET_PRODUCT_BY_HANDLE_QUERY,
      variables: { handle: product.handle },
    },
  })) as GraphQLResponse<{ productByHandle: any }>;

  const productByHandle = productResponse.body.data?.productByHandle;
  const productGid = productByHandle?.id;

  if (!productGid) {
    throw new Error(`Could not find product with handle ${product.handle} to add variant to.`);
  }
  const productId = parseInt(productGid.split('/').pop()!, 10);

  const existingImages = productByHandle.images?.edges.map((e: any) => e.node) || [];

  const getOptionValue = (value: string | null | undefined, fallback: string | null) =>
    value?.trim() ? value.trim() : fallback;

  let imageId = product.imageId;

  // If a mediaUrl is provided, check if it already exists before uploading.
  if (product.mediaUrl && !imageId) {
    const imageFilename = product.mediaUrl.split('/').pop()?.split('?')[0];
    const existingImage = existingImages.find((img: { url: string }) =>
      img.url.includes(imageFilename as string)
    );

    if (existingImage) {
      imageId = parseInt(existingImage.id.split('/').pop()!);
      console.log(`Reusing existing image ID ${imageId} for new variant.`);
    } else {
      console.log(`Uploading new image from URL for new variant: ${product.mediaUrl}`);
      try {
        const newImage = await addProductImage(productId, product.mediaUrl);
        imageId = newImage.id;
        console.log(`New image uploaded with ID: ${imageId}`);
      } catch (error) {
        console.warn(
          `Failed to upload image from URL ${product.mediaUrl}. Variant will be created without an image.`,
          error
        );
      }
    }
  }

  const variantPayload: { variant: any } = {
    variant: {
      price: product.price,
      sku: product.sku,
      compare_at_price: product.compareAtPrice,
      cost: product.costPerItem,
      barcode: product.barcode,
      weight: product.weight,
      weight_unit: 'g',
      inventory_management: 'shopify',
      inventory_policy: 'deny',
      option1: getOptionValue(product.option1Value, product.sku),
      option2: getOptionValue(product.option2Value, null),
      option3: getOptionValue(product.option3Value, null),
      image_id: imageId,
    },
  };

  console.log(
    `Adding product variant to product ID ${productId} with REST payload:`,
    variantPayload
  );

  try {
    const response = await retryOperation(async () => {
      return (await shopifyClient.post({
        path: `products/${productId}/variants`,
        data: variantPayload,
      })) as RestResponse<{ variant: any }>;
    });

    const createdVariant = response.body.variant;
    if (!createdVariant) {
      throw new Error('Variant creation did not return the expected variant data.');
    }

    const fullProductResponse = await retryOperation(async () => {
      return (await shopifyClient.get({
        path: `products/${productId}`,
      })) as RestResponse<{ product: any }>;
    });

    return fullProductResponse.body.product;
  } catch (error: any) {
    console.error('Error adding variant via REST:', error.response?.body || error);
    throw new Error(
      `Failed to add variant. Status: ${error.response?.statusCode} Body: ${JSON.stringify(error.response?.body)}`
    );
  }
}

export async function updateProduct(
  id: string,
  input: { title?: string; bodyHtml?: string; templateSuffix?: string }
) {
  // If we are only updating the title, we can use the more efficient GraphQL mutation
  if (input.title && !input.bodyHtml && !input.templateSuffix) {
    const shopifyClient = getShopifyGraphQLClient();
    const response = await retryOperation(async () => {
      return (await shopifyClient.query({
        data: {
          query: UPDATE_PRODUCT_MUTATION,
          variables: {
            input: {
              id: id,
              title: input.title,
            },
          },
        },
      })) as GraphQLResponse<{ productUpdate: { product: any } }>;
    });
    return response.body.data?.productUpdate?.product;
  }

  // For other updates, like bodyHtml or template, use the REST API
  const shopifyClient = getShopifyRestClient();
  const numericProductId = id.split('/').pop();

  if (!numericProductId) {
    throw new Error(`Invalid Product ID GID for REST update: ${id}`);
  }

  const payload: { product: any } = {
    product: {
      id: numericProductId,
    },
  };

  if (input.bodyHtml) payload.product.body_html = input.bodyHtml;
  if (input.title) payload.product.title = input.title;
  if (input.templateSuffix) payload.product.template_suffix = input.templateSuffix;

  try {
    const response = await retryOperation(async () => {
      return (await shopifyClient.put({
        path: `products/${numericProductId}`,
        data: payload,
      })) as RestResponse<{ product: any }>;
    });
    if (response.body.errors) {
      console.error('Error updating product via REST:', response.body.errors);
      throw new Error(`Failed to update product: ${JSON.stringify(response.body.errors)}`);
    }
    return response.body.product;
  } catch (error: any) {
    console.error('Error during product update via REST:', error.response?.body || error);
    throw new Error(
      `Failed to update product. Status: ${error.response?.statusCode} Body: ${JSON.stringify(error.response?.body)}`
    );
  }
}

export async function updateProductVariant(
  variantId: number,
  input: { image_id?: number | null; price?: number; weight?: number; weight_unit?: 'g' | 'lb' }
) {
  const shopifyClient = getShopifyRestClient();

  const payload = { variant: { id: variantId, ...input } };

  console.log(
    `Phase 2: Updating variant ${variantId} with REST payload:`,
    JSON.stringify(payload, null, 2)
  );

  try {
    const response = await retryOperation(async () => {
      return (await shopifyClient.put({
        path: `variants/${variantId}`,
        data: payload,
      })) as RestResponse<{ variant: any }>;
    });

    if (response.body.errors) {
      console.error('Error updating variant via REST:', response.body.errors);
      throw new Error(`Failed to update variant: ${JSON.stringify(response.body.errors)}`);
    }

    return response.body.variant;
  } catch (error: any) {
    console.error('Error during variant update:', error.response?.body || error);
    throw new Error(
      `Failed to update variant. Status: ${error.response?.statusCode} Body: ${JSON.stringify(error.response?.body)}`
    );
  }
}

export async function deleteProduct(productId: string): Promise<void> {
  const shopifyClient = getShopifyRestClient();
  const numericProductId = productId.split('/').pop();

  if (!numericProductId) {
    throw new Error(`Invalid Product ID GID: ${productId}`);
  }

  console.log(`Attempting to delete product with ID: ${numericProductId}`);
  try {
    await retryOperation(async () => {
      await shopifyClient.delete({
        path: `products/${numericProductId}`,
      });
    });
    console.log(`Successfully deleted product ID: ${numericProductId}`);
  } catch (error: any) {
    console.error(`Error deleting product ID ${numericProductId}:`, error.response?.body || error);
    throw new Error(
      `Failed to delete product. Status: ${error.response?.statusCode} Body: ${JSON.stringify(error.response?.body)}`
    );
  }
}

export async function deleteProductVariant(productId: number, variantId: number): Promise<void> {
  const shopifyClient = getShopifyRestClient();
  console.log(`Attempting to delete variant ${variantId} from product ${productId}`);
  try {
    await retryOperation(async () => {
      await shopifyClient.delete({
        path: `products/${productId}/variants/${variantId}`,
      });
    });
    console.log(`Successfully deleted variant ID ${variantId} from product ID ${productId}`);
  } catch (error: any) {
    console.error(`Error deleting variant ID ${variantId}:`, error.response?.body || error);
    throw new Error(
      `Failed to delete variant. Status: ${error.response?.statusCode} Body: ${JSON.stringify(error.response?.body)}`
    );
  }
}

// --- Inventory and Collection Functions ---

export async function connectInventoryToLocation(inventoryItemId: string, locationId: number) {
  const shopifyClient = getShopifyRestClient();
  const numericInventoryItemId = inventoryItemId.split('/').pop();

  try {
    await retryOperation(async () => {
      await shopifyClient.post({
        path: 'inventory_levels/connect',
        data: {
          location_id: locationId,
          inventory_item_id: numericInventoryItemId,
        },
      });
    });
    console.log(
      `Successfully connected inventory item ${inventoryItemId} to location ${locationId}.`
    );
  } catch (error: any) {
    const errorBody = error.response?.body;
    // Check if the error is that it's already stocked, which is not a failure condition for us.
    if (
      errorBody &&
      errorBody.errors &&
      JSON.stringify(errorBody.errors).includes('is already stocked at the location')
    ) {
      console.log(
        `Inventory item ${inventoryItemId} was already connected to location ${locationId}.`
      );
      return;
    }
    console.error(
      `Error connecting inventory item ${inventoryItemId} to location ${locationId}:`,
      errorBody || error
    );
    throw new Error(
      `Failed to connect inventory to location: ${JSON.stringify(errorBody?.errors || error.message)}`
    );
  }
}

export async function disconnectInventoryFromLocation(inventoryItemId: string, locationId: number) {
  const shopifyClient = getShopifyRestClient();
  const numericInventoryItemId = inventoryItemId.split('/').pop();

  try {
    await retryOperation(async () => {
      await shopifyClient.delete({
        path: 'inventory_levels',
        query: {
          inventory_item_id: numericInventoryItemId || '',
          location_id: locationId,
        },
      });
    });
    console.log(
      `Successfully disconnected inventory item ${inventoryItemId} from location ${locationId}.`
    );
  } catch (error: any) {
    const errorBody = error.response?.body;
    console.error(
      `Error disconnecting inventory item ${inventoryItemId} from location ${locationId}:`,
      errorBody || error
    );
    // Don't throw an error, just log it, as this is a non-critical cleanup step.
  }
}

export async function inventorySetQuantities(
  inventoryItemId: string,
  quantity: number,
  locationId: number
) {
  const shopifyClient = getShopifyGraphQLClient();

  const locationGid = `gid://shopify/Location/${locationId}`;

  const input = {
    name: 'available',
    reason: 'correction',
    ignoreCompareQuantity: true,
    quantities: [
      {
        inventoryItemId: inventoryItemId,
        locationId: locationGid,
        quantity: quantity,
      },
    ],
  };

  try {
    const response = await retryOperation(async () => {
      return (await shopifyClient.query({
        data: {
          query: INVENTORY_SET_QUANTITIES_MUTATION,
          variables: { input },
        },
      })) as GraphQLResponse<{ inventorySetQuantities: { userErrors: any[] } }>;
    });
    const userErrors = response.body.data?.inventorySetQuantities?.userErrors;
    if (userErrors && userErrors.length > 0) {
      console.error('Error setting inventory via GraphQL:', userErrors);
      const errorMessage = userErrors.map((e: any) => e.message).join('; ');
      throw new Error(`Failed to set inventory: ${errorMessage}`);
    }

    console.log(
      `Successfully set inventory for item ${inventoryItemId} at location ${locationId} to ${quantity}.`
    );
  } catch (error: any) {
    console.error('Error updating inventory via GraphQL:', error);
    throw error;
  }
}

export async function getCollectionIdByTitle(title: string): Promise<string | null> {
  const shopifyClient = getShopifyGraphQLClient();
  const formattedQuery = `title:"${title}"`;
  try {
    const response = (await shopifyClient.query({
      data: {
        query: GET_COLLECTION_BY_TITLE_QUERY,
        variables: { query: formattedQuery },
      },
    })) as GraphQLResponse<{ collections: { edges: { node: { id: string } }[] } }>;
    const collectionEdge = response.body.data?.collections?.edges?.[0];
    return collectionEdge?.node?.id || null;
  } catch (error) {
    console.error(`Error fetching collection ID for title "${title}":`, error);
    return null;
  }
}

export async function linkProductToCollection(productGid: string, collectionGid: string) {
  const shopifyClient = getShopifyRestClient();
  const legacyProductId = productGid.split('/').pop();
  const legacyCollectionId = collectionGid.split('/').pop();

  try {
    await retryOperation(async () => {
      await shopifyClient.post({
        path: 'collects',
        data: {
          collect: {
            product_id: legacyProductId,
            collection_id: legacyCollectionId,
          },
        },
      });
    });
    console.log(`Successfully linked product ${productGid} to collection ${collectionGid}.`);
  } catch (error: any) {
    // Don't throw, just warn, as this is a post-creation task.
    // It might fail if the link already exists, which is not a critical error.
    console.warn(
      `Could not link product ${productGid} to collection ${collectionGid}:`,
      error.response?.body || error
    );
  }
}

export async function publishProductToSalesChannels(productGid: string): Promise<void> {
  const shopifyClient = getShopifyGraphQLClient();

  // 1. Fetch all available publications
  const publicationsResponse = (await shopifyClient.query({
    data: { query: GET_ALL_PUBLICATIONS_QUERY },
  })) as GraphQLResponse<{ publications: { edges: { node: { id: string } }[] } }>;
  const publications =
    publicationsResponse.body.data?.publications?.edges.map((edge: any) => edge.node) || [];

  if (publications.length === 0) {
    console.warn(`No sales channel publications found to publish product ${productGid} to.`);
    return;
  }

  const publicationInputs = publications.map((pub: { id: string }) => ({ publicationId: pub.id }));

  // 2. Publish the product to all publications
  try {
    const result = await retryOperation(async () => {
      return (await shopifyClient.query({
        data: {
          query: PUBLISHABLE_PUBLISH_MUTATION,
          variables: {
            id: productGid,
            input: publicationInputs,
          },
        },
      })) as GraphQLResponse<{ publishablePublish: { userErrors: any[] } }>;
    });

    const userErrors = result.body.data?.publishablePublish?.userErrors;
    if (userErrors && userErrors.length > 0) {
      const errorMessages = userErrors.map((e: any) => e.message).join('; ');
      console.warn(
        `Could not publish product ${productGid} to all sales channels: ${errorMessages}`
      );
    } else {
      console.log(
        `Successfully requested to publish product ${productGid} to ${publications.length} sales channels.`
      );
    }
  } catch (error) {
    console.error(`Error during publishProductToSalesChannels for product ${productGid}:`, error);
    // Don't throw, just warn
  }
}

export async function addProductTags(productId: string, tags: string[]): Promise<void> {
  const shopifyClient = getShopifyGraphQLClient();
  try {
    const response = await retryOperation(async () => {
      return (await shopifyClient.query({
        data: {
          query: ADD_TAGS_MUTATION,
          variables: { id: productId, tags },
        },
      })) as GraphQLResponse<{ tagsAdd: { userErrors: any[] } }>;
    });
    const userErrors = response.body.data?.tagsAdd?.userErrors;
    if (userErrors && userErrors.length > 0) {
      throw new Error(`Failed to add tags: ${userErrors[0].message}`);
    }
    console.log(`Successfully added tags to product ${productId}`);
  } catch (error: any) {
    console.error(`Error adding tags to product ${productId}:`, error);
    throw error;
  }
}

export async function removeProductTags(productId: string, tags: string[]): Promise<void> {
  const shopifyClient = getShopifyGraphQLClient();
  try {
    const response = await retryOperation(async () => {
      return (await shopifyClient.query({
        data: {
          query: REMOVE_TAGS_MUTATION,
          variables: { id: productId, tags },
        },
      })) as GraphQLResponse<{ tagsRemove: { userErrors: any[] } }>;
    });
    const userErrors = response.body.data?.tagsRemove?.userErrors;
    if (userErrors && userErrors.length > 0) {
      throw new Error(`Failed to remove tags: ${userErrors[0].message}`);
    }
    console.log(`Successfully removed tags from product ${productId}`);
  } catch (error: any) {
    console.error(`Error removing tags from product ${productId}:`, error);
    throw error;
  }
}

// --- MEDIA FUNCTIONS ---
export async function addProductImage(
  productId: number,
  imageUrl: string
): Promise<ShopifyProductImage> {
  const shopifyClient = getShopifyRestClient();
  try {
    const response = await retryOperation(async () => {
      return (await shopifyClient.post({
        path: `products/${productId}/images`,
        data: {
          image: {
            src: imageUrl,
          },
        },
      })) as RestResponse<{ image: ShopifyProductImage }>;
    });
    return response.body.image;
  } catch (error: any) {
    console.error(`Error adding image to product ${productId}:`, error.response?.body || error);
    throw new Error(
      `Failed to add image: ${JSON.stringify(error.response?.body?.errors || error.message)}`
    );
  }
}

export async function deleteProductImage(productId: number, imageId: number): Promise<void> {
  const shopifyClient = getShopifyRestClient();
  try {
    await retryOperation(async () => {
      await shopifyClient.delete({
        path: `products/${productId}/images/${imageId}`,
      });
    });
  } catch (error: any) {
    console.error(
      `Error deleting image ${imageId} from product ${productId}:`,
      error.response?.body || error
    );
    throw new Error(
      `Failed to delete image: ${JSON.stringify(error.response?.body?.errors || error.message)}`
    );
  }
}

// --- BULK OPERATIONS ---

export async function startProductExportBulkOperation(): Promise<{ id: string; status: string }> {
  const shopifyClient = getShopifyGraphQLClient();

  // First, check if an operation is already running.
  const currentOpResponse = (await shopifyClient.query({
    data: { query: GET_CURRENT_BULK_OPERATION_QUERY },
  })) as GraphQLResponse<{ currentBulkOperation: any }>;
  const currentOperation = currentOpResponse.body.data?.currentBulkOperation;
  if (
    currentOperation &&
    (currentOperation.status === 'RUNNING' || currentOperation.status === 'CREATED')
  ) {
    console.log(`Found existing bulk operation: ${currentOperation.id}. Recovering...`);
    return { id: currentOperation.id, status: currentOperation.status };
  }

  const query = `
        query {
            products {
                edges {
                    node {
                        id
                        title
                        handle
                        vendor
                        productType
                        tags
                        bodyHtml
                        templateSuffix
                        variants {
                            edges {
                                node {
                                    id
                                    sku
                                    price
                                    inventoryQuantity
                                    inventoryItem {
                                        id
                                        unitCost {
                                            amount
                                        }
                                        tracked
                                        measurement {
                                            weight {
                                                value
                                                unit
                                            }
                                        }
                                        inventoryLevels(first: 5) {
                                            edges {
                                                node {
                                                    id
                                                    location {
                                                        id
                                                    }
                                                }
                                            }
                                        }
                                    }
                                    image {
                                      id
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    `;

  const response = (await shopifyClient.query({
    data: {
      query: BULK_OPERATION_RUN_QUERY_MUTATION,
      variables: { query },
    },
  })) as GraphQLResponse<{ bulkOperationRunQuery: { bulkOperation: any; userErrors: any[] } }>;

  const userErrors = response.body.data?.bulkOperationRunQuery?.userErrors;
  if (userErrors && userErrors.length > 0) {
    throw new Error(`Failed to start bulk operation: ${userErrors[0].message}`);
  }

  const bulkOperation = response.body.data?.bulkOperationRunQuery?.bulkOperation;
  if (!bulkOperation) {
    throw new Error('Could not start bulk operation.');
  }

  return bulkOperation;
}

export async function checkBulkOperationStatus(
  id: string
): Promise<{ id: string; status: string; resultUrl?: string }> {
  const shopifyClient = getShopifyGraphQLClient();

  const currentOpResponse = (await shopifyClient.query({
    data: { query: GET_CURRENT_BULK_OPERATION_QUERY },
  })) as GraphQLResponse<{ currentBulkOperation: any }>;

  const operation = currentOpResponse.body.data?.currentBulkOperation;

  if (operation && operation.id !== id && operation.status === 'RUNNING') {
    // A different operation is running. Our job is likely queued. Keep polling.
    console.warn(
      `Polling for operation ${id}, but a different operation ${operation.id} is currently running. Continuing to poll.`
    );
    return { id: id, status: 'RUNNING' };
  }

  if (operation && operation.id === id) {
    // Our operation is the current one. Return its status.
    return { id: operation.id, status: operation.status, resultUrl: operation.url };
  }

  // If we get here, it means there's no running operation. Our job must be done (or failed/cancelled).
  // We need to query for it specifically to get the final URL.
  const specificOpQuery = `
      query getSpecificBulkOperation($id: ID!) {
        node(id: $id) {
          ... on BulkOperation {
            id
            status
            url
            errorCode
          }
        }
      }
    `;
  const specificOpResponse = (await shopifyClient.query({
    data: {
      query: specificOpQuery,
      variables: { id },
    },
  })) as GraphQLResponse<{ node: any }>;

  const specificOperation = specificOpResponse.body.data?.node;

  if (specificOperation) {
    if (specificOperation.status === 'FAILED') {
      console.error(`Bulk operation ${id} failed with code: ${specificOperation.errorCode}`);
    }
    return {
      id: specificOperation.id,
      status: specificOperation.status,
      resultUrl: specificOperation.url,
    };
  }

  // If even the specific query fails, we have an issue.
  throw new Error(`Could not retrieve status for bulk operation ${id}.`);
}

export async function getBulkOperationResult(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download bulk operation result from ${url}`);
  }
  return response.text();
}

export async function parseBulkOperationResult(jsonlContent: string): Promise<Product[]> {
  const lines = jsonlContent.split('\n').filter((line) => line.trim() !== '');
  const products: Product[] = [];
  const parentProducts = new Map<string, any>();
  const locationMap = new Map<string, string[]>();

  // First pass: map all parent products and collect location data
  let logCount = 0;
  for (const line of lines) {
    const item = JSON.parse(line);

    if (logCount < 5 && item.location) {
      console.log('DEBUG: Found location item:', JSON.stringify(item));
      logCount++;
    }

    // Map Parent Products
    if (item.id && item.id.includes('gid://shopify/Product/')) {
      parentProducts.set(item.id, item);
    }

    // Collect Location Data (InventoryLevel nodes)
    // These lines will have a location object and a __parentId
    if (item.location && item.location.id && item.__parentId) {
      if (!locationMap.has(item.__parentId)) {
        locationMap.set(item.__parentId, []);
      }
      locationMap.get(item.__parentId)?.push(item.location.id);
    }
  }

  // Second pass: create product entries for each variant, linking to its parent
  for (const line of lines) {
    const shopifyProduct = JSON.parse(line);

    if (shopifyProduct.id && shopifyProduct.id.includes('gid://shopify/ProductVariant')) {
      const variantId = shopifyProduct.id;
      const sku = shopifyProduct.sku;
      const parentId = shopifyProduct.__parentId;

      const parentProduct = parentProducts.get(parentId);

      if (parentProduct && sku) {
        // Look up locations using Variant ID (most likely parent) or InventoryItem ID
        let locs = locationMap.get(variantId) || [];

        // Fallback: check if locations are linked to the InventoryItem ID
        if (locs.length === 0 && shopifyProduct.inventoryItem?.id) {
          locs = locationMap.get(shopifyProduct.inventoryItem.id) || [];
        }

        products.push({
          id: parentProduct.id,
          variantId: variantId,
          barcode: shopifyProduct.barcode || null,
          inventoryItemId: shopifyProduct.inventoryItem?.id,
          handle: parentProduct.handle,
          sku: sku,
          name: parentProduct.title,
          price: parseFloat(shopifyProduct.price),
          inventory: shopifyProduct.inventoryQuantity,
          descriptionHtml: parentProduct.bodyHtml,
          productType: parentProduct.productType,
          vendor: parentProduct.vendor,
          tags: parentProduct.tags.join(', '),
          compareAtPrice: null,
          costPerItem: shopifyProduct.inventoryItem?.unitCost?.amount
            ? parseFloat(shopifyProduct.inventoryItem.unitCost.amount)
            : null,
          weight: shopifyProduct.inventoryItem?.measurement?.weight?.value
            ? convertWeightToGrams(
              parseFloat(shopifyProduct.inventoryItem.measurement.weight.value),
              shopifyProduct.inventoryItem.measurement.weight.unit
            )
            : null,
          mediaUrl: null, // Note: Bulk export doesn't easily link variant images
          imageId: shopifyProduct.image?.id
            ? parseInt(shopifyProduct.image.id.split('/').pop(), 10)
            : null,
          category: null,
          option1Name: null,
          option1Value: null,
          option2Name: null,
          option2Value: null,
          option3Name: null,
          option3Value: null,
          templateSuffix: parentProduct.templateSuffix,
          locationIds: locs,
        });
      }
    }
  }
  console.log(`Parsed ${products.length} products from bulk operation result.`);
  return products;
}

export async function getFullProduct(productId: number): Promise<any> {
  const shopifyClient = getShopifyRestClient();
  try {
    const response = (await shopifyClient.get({
      path: `products/${productId}`,
    })) as RestResponse<{ product: any }>;
    return response.body.product;
  } catch (error: any) {
    console.error(`Error fetching full product ${productId}:`, error.response?.body || error);
    throw new Error(
      `Failed to fetch product: ${JSON.stringify(error.response?.body?.errors || error.message)}`
    );
  }
}

export async function getProductImageCounts(productIds: number[]): Promise<Record<number, number>> {
  const shopifyClient = getShopifyGraphQLClient();
  const counts: Record<number, number> = {};

  for (const id of productIds) {
    const query = `
            query getProductImageCount($id: ID!) {
                product(id: $id) {
                    media(first: 0) {
                        totalCount
                    }
                }
            }
        `;
    try {
      const response = (await shopifyClient.query({
        data: {
          query: query,
          variables: { id: `gid://shopify/Product/${id}` },
        },
      })) as GraphQLResponse<{ product: { media: { totalCount: number } } }>;

      if (response.body.data?.product?.media) {
        counts[id] = response.body.data.product.media.totalCount;
      } else {
        counts[id] = 0;
      }
      await sleep(100); // Slight delay to be nice
    } catch (error) {
      console.error(`Error fetching image count for product ${id}:`, error);
      counts[id] = 0;
    }
  }
  return counts;
}
