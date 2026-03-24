import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '2m', target: 5 },
    { duration: '5m', target: 10 },
    { duration: '2m', target: 0 },
  ],
  thresholds: {
    http_req_failed: ['rate<0.05'],
  },
};

// Pool de utilizadores de teste
const USERS = [
  { email: 'teste0@nopCommerce.com', password: '1234', name: 'Teste 0' },
  { email: 'teste1@nopCommerce.com', password: '1234', name: 'Teste 1' },
  { email: 'teste2@nopCommerce.com', password: '1234', name: 'Teste 2' },
  { email: 'teste3@nopCommerce.com', password: '1234', name: 'Teste 3' },
  { email: 'teste4@nopCommerce.com', password: '1234', name: 'Teste 4' },
  { email: 'teste5@nopCommerce.com', password: '1234', name: 'Teste 5' },
];

const BASE_URL = 'http://localhost:5000';
const PRODUCT_SE_NAME = 'apple-iphone-16-128gb'; // produto simples
const FAILURE_PROFILE = [
  { scenario: 'success', weight: 0.60 },
  { scenario: 'card_expired', weight: 0.10 },
  { scenario: 'invalid_card_number', weight: 0.08 },
  { scenario: 'cvv_invalid', weight: 0.07 },
  { scenario: 'invalid_payment_method', weight: 0.06 },
  { scenario: 'invalid_shipping_option', weight: 0.05 },
  { scenario: 'abandon_before_confirm', weight: 0.04 },
];

function pickFailureScenario() {
  const roll = Math.random();
  let accumulated = 0;

  for (const item of FAILURE_PROFILE) {
    accumulated += item.weight;
    if (roll <= accumulated) return item.scenario;
  }

  return 'success';
}

function isCardFailureScenario(scenario) {
  return scenario === 'card_expired' || scenario === 'invalid_card_number' || scenario === 'cvv_invalid';
}

function pickUser() {
  // Distribui utilizadores entre VUs/iterações de forma determinística
  const vu = typeof __VU === 'number' ? __VU : 1;
  const iter = typeof __ITER === 'number' ? __ITER : 0;
  const idx = (vu - 1 + iter) % USERS.length;
  return USERS[idx];
}

// Função para extrair token anti-forgery
function extractVerificationToken(html) {
  if (!html || typeof html !== 'string') return null;
  const match = html.match(/<input[^>]*name="__RequestVerificationToken"[^>]*value="([^"]+)"[^>]*>/i);
  return match ? match[1] : null;
}

function isConnectionError(res) {
  return !res || res.status === 0 || !res.body;
}

// Função para verificar se o carrinho tem itens
function cartHasItems(html) {
  if (!html) return false;

  const hasEmptyMessage = html.includes('Your Shopping Cart is empty!') || html.includes('O seu carrinho de compras est') && html.includes('vazio');
  const hasQtyInput = /name="itemquantity\d+"/i.test(html);
  const hasCartRow = html.includes('cart-item-row') || html.includes('class="product"');

  return !hasEmptyMessage && (hasQtyInput || hasCartRow);
}

function extractProductIdFromPage(html) {
  const match = html.match(/\/addproducttocart\/details\/(\d+)\/1/i);
  return match ? Number(match[1]) : null;
}

function parseJsonSafely(body) {
  try {
    return JSON.parse(body);
  } catch (_) {
    return null;
  }
}

function extractSelectValue(html, selectName) {
  if (!html) return null;

  const selectRegex = new RegExp(`<select[^>]*name=["']${selectName}["'][^>]*>([\\s\\S]*?)<\\/select>`, 'i');
  const selectMatch = html.match(selectRegex);
  if (!selectMatch) return null;

  const optionsHtml = selectMatch[1];

  const selectedMatch = optionsHtml.match(/<option[^>]*value=["']([^"']+)["'][^>]*selected[^>]*>/i);
  if (selectedMatch && selectedMatch[1] !== '0') return selectedMatch[1];

  const firstValidMatch = optionsHtml.match(/<option[^>]*value=["']([^"']+)["'][^>]*>/i);
  if (firstValidMatch && firstValidMatch[1] !== '0') return firstValidMatch[1];

  return null;
}

function extractRadioValue(html, inputName, preferredValue = null) {
  if (!html) return null;

  const radioRegex = new RegExp(`<input(?=[^>]*name=["']${inputName}["'])(?=[^>]*type=["']radio["'])[^>]*>`, 'ig');
  const inputs = html.match(radioRegex) || [];
  if (!inputs.length) return null;

  const values = inputs
    .map((input) => {
      const valueMatch = input.match(/value=["']([^"']+)["']/i);
      return valueMatch ? valueMatch[1] : null;
    })
    .filter(Boolean);

  if (!values.length) return null;
  if (preferredValue && values.includes(preferredValue)) return preferredValue;

  const checkedInput = inputs.find((input) => /checked/i.test(input));
  if (checkedInput) {
    const checkedValue = checkedInput.match(/value=["']([^"']+)["']/i);
    if (checkedValue) return checkedValue[1];
  }

  return values[0];
}

function readStepJson(label, response) {
  const parsed = parseJsonSafely(response.body);
  if (!parsed) {
    console.log(`${label}: invalid JSON response`);
    return null;
  }

  if (parsed.error) {
    console.log(`${label}: ${parsed.message || 'unknown error'}`);
    return null;
  }

  return parsed;
}

function buildCheckoutAttributesPayload(html) {
  if (!html) return {};

  const payload = {};
  const names = [...html.matchAll(/name=["'](checkout_attribute_\d+)["']/ig)]
    .map((m) => m[1])
    .filter((name, idx, all) => all.indexOf(name) === idx);

  for (const name of names) {
    const selected = extractSelectValue(html, name) || extractRadioValue(html, name);
    if (selected) payload[name] = selected;
  }

  return payload;
}
function extractCardDataFields(html) {
  // Extrai nomes de campos de cartão que existem no formulário
  if (!html) return [];

  const cardFields = [];
  const fieldPatterns = [
    'cardholdername',
    'cardnumber',
    'expirationmonth',
    'expirationyear',
    'cardcode' // CVV
  ];

  for (const pattern of fieldPatterns) {
    const regex = new RegExp(`name=["'](.*?${pattern}.*?)["']`, 'i');
    const match = html.match(regex);
    if (match) {
      cardFields.push(match[1]);
    }
  }

  return cardFields;
}

function buildCardPayloadByScenario(cardFields, scenario) {
  const payload = {};

  for (const field of cardFields) {
    const lowerField = field.toLowerCase();

    if (lowerField.includes('cardholdername')) {
      payload[field] = 'John Doe';
    } else if (lowerField.includes('cardnumber')) {
      if (scenario === 'invalid_card_number') {
        payload[field] = '4111111111111111DEV';
      } else {
        payload[field] = '4111111111111111';
      }
    } else if (lowerField.includes('expirationmonth')) {
      payload[field] = '12';
    } else if (lowerField.includes('expirationyear')) {
      payload[field] = scenario === 'card_expired' ? '2020' : '2028';
    } else if (lowerField.includes('cardcode')) {
      payload[field] = scenario === 'cvv_invalid' ? '000' : '123';
    }
  }

  return payload;
}
export default function () {
  const selectedScenario = pickFailureScenario();
  const user = pickUser();
  console.log(`Scenario selected: ${selectedScenario}`);
  console.log(`User selected: ${user.email}`);

  // --- 1. LOGIN ---
  let res = http.get(`${BASE_URL}/login`);
  if (isConnectionError(res)) {
    console.log(`Backend unavailable at ${BASE_URL} (login request failed)`);
    sleep(1);
    return;
  }

  let token = extractVerificationToken(res.body);
  if (!token) {
    console.log('Token not found on login page');
    return;
  }

  const loginPayload = {
    Email: user.email,
    Password: user.password,
    __RequestVerificationToken: token,
    RememberMe: 'false',
  };
  res = http.post(`${BASE_URL}/login`, loginPayload, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    redirects: 5,
  });

  if (!res.url.includes('/')) {
    console.log(`Login failed for ${user.email}`);
    return;
  }
  console.log(`✓ Logged in as ${user.email}`);

  // --- 2. PÁGINA DO PRODUTO (para obter token) ---
  let productPage = http.get(`${BASE_URL}/${PRODUCT_SE_NAME}`);
  if (isConnectionError(productPage)) {
    console.log(`Backend unavailable at ${BASE_URL} (product page request failed)`);
    sleep(1);
    return;
  }

  if (productPage.status !== 200) {
    console.log(`Product page not found for ${PRODUCT_SE_NAME}`);
    return;
  }

  const productId = extractProductIdFromPage(productPage.body);
  if (!productId) {
    console.log(`Could not extract product id from page ${PRODUCT_SE_NAME}`);
    return;
  }

  token = extractVerificationToken(productPage.body);
  if (!token) {
    console.log(`Token not found on product page for ${PRODUCT_SE_NAME}`);
    return;
  }

  // --- 3. ADICIONAR PRODUTO AO CARRINHO (URL direto) ---
  const addToCartUrl = `${BASE_URL}/addproducttocart/details/${productId}/1`;
  const addPayload = {
    __RequestVerificationToken: token,
    [`addtocart_${productId}.EnteredQuantity`]: '1',
  };
  res = http.post(addToCartUrl, addPayload, {
    redirects: 3,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-Requested-With': 'XMLHttpRequest',
    },
  });
  console.log(`Add to cart response: status=${res.status}, url=${res.url}`);

  const addResult = parseJsonSafely(res.body);
  if (addResult && addResult.success === false) {
    console.log(`Add to cart validation failed: ${addResult.message || addResult.errors || 'unknown error'}`);
    return;
  }

  if (res.status !== 200 && res.status !== 302) {
    console.log(`Add to cart failed with status ${res.status}`);
    return;
  }

  sleep(1);

  // --- 4. VERIFICAR CARRINHO ---
  let cartPage = http.get(`${BASE_URL}/cart`);
  if (!cartHasItems(cartPage.body)) {
    console.log(`Cart is empty after adding product ${productId}`);
    return;
  }
  console.log(`✓ Product ${productId} is in cart`);

  // Preenche atributos obrigatórios de checkout (ex.: Gift wrapping) antes do OPC.
  const cartToken = extractVerificationToken(cartPage.body);
  const checkoutAttributes = buildCheckoutAttributesPayload(cartPage.body);
  if (cartToken && Object.keys(checkoutAttributes).length > 0) {
    const checkoutAttributePayload = {
      __RequestVerificationToken: cartToken,
      ...checkoutAttributes,
    };

    const checkoutAttrRes = http.post(
      `${BASE_URL}/shoppingcart/checkoutattributechange/true`,
      checkoutAttributePayload,
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'X-Requested-With': 'XMLHttpRequest',
        },
        redirects: 0,
      }
    );

    const checkoutAttrJson = parseJsonSafely(checkoutAttrRes.body);
    if (!checkoutAttrJson) {
      console.log('Checkout attributes update failed: invalid JSON response');
      return;
    }
  }

  // --- 5. CHECKOUT (One Page Checkout) ---
  const ajaxHeaders = {
    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    'X-Requested-With': 'XMLHttpRequest',
  };

  let opcPage = http.get(`${BASE_URL}/onepagecheckout`);
  if (opcPage.status !== 200) {
    console.log(`Checkout page not accessible (status ${opcPage.status})`);
    return;
  }

  token = extractVerificationToken(opcPage.body);
  if (!token) {
    console.log('Token missing on onepagecheckout');
    return;
  }

  // --- 6. OPC BILLING ---
  const billingAddressId = extractSelectValue(opcPage.body, 'billing_address_id') || '0';
  const billingCountryId = extractSelectValue(opcPage.body, 'BillingNewAddress.CountryId') || '1';
  const billingStateId = extractSelectValue(opcPage.body, 'BillingNewAddress.StateProvinceId') || '0';
  const billingPayload = {
    __RequestVerificationToken: token,
    billing_address_id: billingAddressId,
    ShipToSameAddress: 'true',
  };

  if (billingAddressId === '0') {
    Object.assign(billingPayload, {
      'BillingNewAddress.FirstName': 'Admin',
      'BillingNewAddress.LastName': 'User',
      'BillingNewAddress.Email': user.email,
      'BillingNewAddress.CountryId': billingCountryId,
      'BillingNewAddress.StateProvinceId': billingStateId,
      'BillingNewAddress.City': 'Porto',
      'BillingNewAddress.Address1': 'Rua Principal 123',
      'BillingNewAddress.ZipPostalCode': '4000-000',
      'BillingNewAddress.PhoneNumber': '910000000',
    });
  }

  res = http.post(
    `${BASE_URL}/checkout/OpcSaveBilling/`,
    billingPayload,
    { headers: ajaxHeaders, redirects: 0 }
  );
  let billingJson = readStepJson('OpcSaveBilling failed', res);
  if (!billingJson) return;

  // --- 7. OPC SHIPPING ADDRESS (se aplicável) ---
  let shippingJson = billingJson;
  const shippingAddressHtml = billingJson.update_section && billingJson.update_section.name === 'shipping'
    ? billingJson.update_section.html
    : '';
  if (shippingAddressHtml) {
    const shippingAddressId = extractSelectValue(shippingAddressHtml, 'shipping_address_id')
      || extractSelectValue(opcPage.body, 'shipping_address_id')
      || '0';

    res = http.post(
      `${BASE_URL}/checkout/OpcSaveShipping/`,
      {
        __RequestVerificationToken: token,
        shipping_address_id: shippingAddressId,
      },
      { headers: ajaxHeaders, redirects: 0 }
    );

    shippingJson = readStepJson('OpcSaveShipping failed', res);
    if (!shippingJson) return;
  }

  // --- 8. OPC SHIPPING METHOD (se aplicável) ---
  let shippingMethodJson = shippingJson;
  const shippingMethodHtml = shippingJson.update_section && shippingJson.update_section.name === 'shipping-method'
    ? shippingJson.update_section.html
    : '';
  if (shippingMethodHtml) {
    const validShippingOption = extractRadioValue(shippingMethodHtml, 'shippingoption');
    const shippingOption = selectedScenario === 'invalid_shipping_option'
      ? 'Ground___InvalidShippingProvider'
      : validShippingOption;

    if (!shippingOption) {
      console.log('No shipping option found in OPC shipping method step');
      return;
    }

    if (selectedScenario === 'invalid_shipping_option') {
      console.log('Injecting invalid shipping option to simulate shipping failure');
    }

    res = http.post(
      `${BASE_URL}/checkout/OpcSaveShippingMethod/`,
      {
        __RequestVerificationToken: token,
        shippingoption: shippingOption,
      },
      { headers: ajaxHeaders, redirects: 0 }
    );

    shippingMethodJson = readStepJson('OpcSaveShippingMethod failed', res);
    if (!shippingMethodJson) return;
  }

  // --- 9. OPC PAYMENT METHOD ---
  const paymentMethodHtml = shippingMethodJson.update_section && shippingMethodJson.update_section.name === 'payment-method'
    ? shippingMethodJson.update_section.html
    : '';

  const preferredPaymentMethod = isCardFailureScenario(selectedScenario) ? 'Payments.Manual' : 'Payments.CheckMoneyOrder';
  const validPaymentMethod = extractRadioValue(paymentMethodHtml, 'paymentmethod', preferredPaymentMethod) || 'Payments.CheckMoneyOrder';
  const paymentMethod = selectedScenario === 'invalid_payment_method' ? 'Payments.InvalidMethod' : validPaymentMethod;

  if (selectedScenario === 'invalid_payment_method') {
    console.log('Injecting invalid payment method to simulate payment-method failure');
  }

  res = http.post(
    `${BASE_URL}/checkout/OpcSavePaymentMethod/`,
    {
      __RequestVerificationToken: token,
      paymentmethod: paymentMethod,
    },
    { headers: ajaxHeaders, redirects: 0 }
  );
  let paymentMethodJson = readStepJson('OpcSavePaymentMethod failed', res);
  if (!paymentMethodJson) return;

  // --- 10. OPC PAYMENT INFO (se aplicável) ---
  if (paymentMethodJson.goto_section === 'payment_info' || (paymentMethodJson.update_section && paymentMethodJson.update_section.name === 'payment-info')) {
    const paymentInfoHtml = paymentMethodJson.update_section ? paymentMethodJson.update_section.html : '';
    const cardFields = extractCardDataFields(paymentInfoHtml);

    let cardDataPayload = {};

    if (cardFields.length > 0) {
      cardDataPayload = buildCardPayloadByScenario(cardFields, selectedScenario);

      if (isCardFailureScenario(selectedScenario)) {
        console.log(`Injecting card failure scenario: ${selectedScenario}`);
      }
    }

    res = http.post(
      `${BASE_URL}/checkout/OpcSavePaymentInfo/`,
      {
        __RequestVerificationToken: token,
        ...cardDataPayload
      },
      { headers: ajaxHeaders, redirects: 0 }
    );
    const paymentInfoJson = readStepJson('OpcSavePaymentInfo failed', res);
    if (!paymentInfoJson) return;
  }

  if (selectedScenario === 'abandon_before_confirm') {
    console.log('Simulating cart abandonment before order confirmation');
    sleep(1);
    return;
  }

  // --- 11. OPC CONFIRM ORDER ---
  res = http.post(
    `${BASE_URL}/checkout/OpcConfirmOrder/`,
    { __RequestVerificationToken: token },
    { headers: ajaxHeaders, redirects: 0 }
  );

  const confirmJson = parseJsonSafely(res.body);
  if (!confirmJson) {
    console.log('OpcConfirmOrder failed: invalid JSON response');
    return;
  }

  if (confirmJson.error) {
    console.log(`OpcConfirmOrder failed: ${confirmJson.message || 'unknown error'}`);
    return;
  }

  const confirmSuccess = confirmJson.success === true || confirmJson.success === 1 || confirmJson.success === '1';
  if ((confirmJson.redirect && confirmJson.redirect.includes('/checkout/completed')) || confirmSuccess) {
    console.log(`✓ Order completed for ${user.email} with product ${PRODUCT_SE_NAME}`);
  } else {
    console.log(`✗ Order not completed for ${user.email} (redirect: ${confirmJson.redirect || 'none'}, success: ${String(confirmJson.success)})`);
  }

  sleep(2);
}