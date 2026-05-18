/* =========================
   CART DATA
========================= */
let cart = JSON.parse(localStorage.getItem('cart')) || [];
let paymentUnlocked = false;
let upiStatusPollTimer = null;
const ANALYTICS_ENDPOINT = 'http://localhost:5000/api/analytics/event';

function getAnalyticsSessionId() {
  const key = 'analyticsSessionId';
  let sessionId = localStorage.getItem(key);
  if (sessionId) return sessionId;

  sessionId = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  localStorage.setItem(key, sessionId);
  return sessionId;
}

function trackAnalyticsEvent(eventName, metadata) {
  try {
    const name = String(eventName || '').trim().toLowerCase();
    if (!name) return;

    const token = localStorage.getItem('token') || '';
    fetch(ANALYTICS_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: 'Bearer ' + token } : {})
      },
      body: JSON.stringify({
        eventName: name,
        page: window.location.pathname.split('/').pop() || '',
        source: 'web',
        sessionId: getAnalyticsSessionId(),
        metadata: metadata && typeof metadata === 'object' ? metadata : {}
      }),
      keepalive: true
    }).catch(() => {});
  } catch (err) {
    // Analytics should never break user flow.
  }
}

window.trackAnalyticsEvent = trackAnalyticsEvent;

function optimizeNonCriticalImages() {
  const images = document.querySelectorAll('img');
  images.forEach((img, index) => {
    const isHeroSlider = !!img.closest('.hero-image-slider');
    const isLikelyCriticalHero = isHeroSlider && index <= 1;
    if (isLikelyCriticalHero) {
      img.loading = 'eager';
      img.decoding = 'async';
      return;
    }

    if (!img.getAttribute('loading')) {
      img.setAttribute('loading', 'lazy');
    }
    if (!img.getAttribute('decoding')) {
      img.setAttribute('decoding', 'async');
    }
  });
}

function getCurrentUserBillingStorageKey() {
  const token = localStorage.getItem('token') || '';
  if (!token) return 'billingAddress:guest';

  try {
    const parts = token.split('.');
    if (parts.length < 2) return 'billingAddress:guest';

    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const decoded = JSON.parse(atob(payload));
    const userId = decoded?.id || decoded?._id || decoded?.sub;
    return userId ? `billingAddress:${String(userId)}` : 'billingAddress:guest';
  } catch (err) {
    return 'billingAddress:guest';
  }
}

function saveBillingAddressToStorage(address) {
  try {
    localStorage.setItem(getCurrentUserBillingStorageKey(), JSON.stringify(address || {}));
  } catch (err) {
    // Ignore quota / storage exceptions.
  }
}

function loadSavedBillingAddress() {
  try {
    return JSON.parse(localStorage.getItem(getCurrentUserBillingStorageKey()) || 'null');
  } catch (err) {
    return null;
  }
}

function applySavedBillingAddress() {
  const saved = loadSavedBillingAddress();
  if (!saved || typeof saved !== 'object') return;

  const setValue = (id, value) => {
    const el = document.getElementById(id);
    if (el && !String(el.value || '').trim()) {
      el.value = value || '';
      if (id === 'billCountry') {
        el.dispatchEvent(new Event('change'));
      }
    }
  };

  setValue('billFirstName', saved.firstName);
  setValue('billLastName', saved.lastName);
  setValue('billEmail', saved.email);
  setValue('billPhone', saved.phone);
  setValue('billCountry', saved.country);
  setValue('billAddress', saved.address);
  setValue('billCity', saved.city);
  setValue('billState', saved.state);
  setValue('billZip', saved.zip);

  const shipSameEl = document.getElementById('shipSameAddress');
  if (shipSameEl && typeof saved.shipSameAddress === 'boolean') {
    shipSameEl.checked = saved.shipSameAddress;
  }
}

function splitName(name) {
  const fullName = String(name || '').trim();
  if (!fullName) {
    return { firstName: '', lastName: '' };
  }

  const parts = fullName.split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] || '',
    lastName: parts.slice(1).join(' ')
  };
}

function mapProfileToBilling(user) {
  if (!user || typeof user !== 'object') return null;

  const nameParts = splitName(user.name);
  const code = String(user.countryCode || '').trim();
  const mobile = String(user.mobileNumber || '').trim();
  const formattedPhone = mobile
    ? (mobile.startsWith('+') ? mobile : `${code || '+91'} ${mobile}`.trim())
    : '';

  return {
    firstName: nameParts.firstName,
    lastName: nameParts.lastName,
    email: String(user.email || '').trim(),
    phone: formattedPhone,
    country: String(user.country || '').trim() || 'India',
    address: String(user.streetAddress || user.address || '').trim(),
    city: String(user.district || '').trim(),
    state: String(user.state || '').trim(),
    zip: String(user.pincode || '').trim()
  };
}

async function fetchUserProfileBilling() {
  const token = localStorage.getItem('token') || '';
  if (!token) return null;

  try {
    const response = await fetch('http://localhost:5000/api/auth/profile', {
      method: 'GET',
      headers: {
        'Authorization': 'Bearer ' + token
      }
    });

    if (!response.ok) return null;
    const data = await response.json();
    return mapProfileToBilling(data?.user);
  } catch (err) {
    return null;
  }
}

function hasAnyBillingValue() {
  const fieldIds = [
    'billFirstName',
    'billLastName',
    'billEmail',
    'billPhone',
    'billAddress',
    'billCity',
    'billZip'
  ];

  return fieldIds.some((id) => {
    const el = document.getElementById(id);
    return !!(el && String(el.value || '').trim());
  });
}

async function applyProfileBillingAddress() {
  if (hasAnyBillingValue()) return;

  const profileBilling = await fetchUserProfileBilling();
  if (!profileBilling) return;

  const setValue = (id, value) => {
    const el = document.getElementById(id);
    if (el && !String(el.value || '').trim()) {
      el.value = value || '';
    }
  };

  setValue('billFirstName', profileBilling.firstName);
  setValue('billLastName', profileBilling.lastName);
  setValue('billEmail', profileBilling.email);
  setValue('billPhone', profileBilling.phone);
  setValue('billAddress', profileBilling.address);
  setValue('billCity', profileBilling.city);
  setValue('billZip', profileBilling.zip);

  const countryEl = document.getElementById('billCountry');
  const currentCountry = countryEl ? String(countryEl.value || '').trim() : '';
  if (countryEl && profileBilling.country && (!currentCountry || currentCountry === 'India')) {
    countryEl.value = profileBilling.country;
    countryEl.dispatchEvent(new Event('change'));
  }

  if (profileBilling.state) {
    setTimeout(() => {
      const stateEl = document.getElementById('billState');
      if (stateEl && !String(stateEl.value || '').trim()) {
        stateEl.value = profileBilling.state;
      }
    }, 0);
  }
}

function initializeBillingLocationSelectors() {
  if (typeof window.initializeWorldLocationSelectors !== 'function') return;

  window.initializeWorldLocationSelectors({
    countrySelectId: 'billCountry',
    stateSelectId: 'billState',
    defaultCountry: 'India'
  });
}

function highlightActiveNavbarLink() {
  const navLinks = document.querySelectorAll('.nav-center a[href]');
  const navIconLinks = document.querySelectorAll('.nav-right a[href]');
  if (!navLinks.length && !navIconLinks.length) return;

  const currentPath = String(window.location.pathname || '').replace(/\\/g, '/');
  const currentPage = currentPath.split('/').pop() || '1.index.html';

  navLinks.forEach((link) => {
    const href = String(link.getAttribute('href') || '').trim();
    if (!href || href.startsWith('#') || href.startsWith('javascript:')) return;

    let targetPage = '';
    try {
      const resolved = new URL(href, window.location.origin + '/');
      targetPage = resolved.pathname.split('/').pop() || '1.index.html';
    } catch (err) {
      return;
    }

    const isCurrent = targetPage.toLowerCase() === currentPage.toLowerCase();
    link.classList.toggle('nav-current', isCurrent);
    if (isCurrent) {
      link.classList.add('active');
      link.setAttribute('aria-current', 'page');
    } else {
      link.removeAttribute('aria-current');
    }
  });

  navIconLinks.forEach((link) => {
    const href = String(link.getAttribute('href') || '').trim();
    if (!href || href.startsWith('#') || href.startsWith('javascript:')) return;

    let targetPage = '';
    try {
      const resolved = new URL(href, window.location.origin + '/');
      targetPage = resolved.pathname.split('/').pop() || '1.index.html';
    } catch (err) {
      return;
    }

    const isCurrent = targetPage.toLowerCase() === currentPage.toLowerCase();
    link.classList.toggle('nav-icon-current', isCurrent);
    if (isCurrent) {
      link.setAttribute('aria-current', 'page');
    } else {
      link.removeAttribute('aria-current');
    }
  });
}

function saveCart() {
  localStorage.setItem('cart', JSON.stringify(cart));
  updateCartCount();
}

/* =========================
   ADD TO CART
========================= */
function addToCart(name, price, image) {
  let existing = cart.find(item => item.name === name);
  if (existing) {
    existing.quantity += 1;
  } else {
    cart.push({ name, price, image, quantity: 1 });
  }
  saveCart();
  showToast(name + ' added to cart!');
  trackAnalyticsEvent('add_to_cart', {
    productName: String(name || ''),
    price: Number(price) || 0,
    image: String(image || '')
  });
  // Track in recommendation engine
  if (typeof RecommendationEngine !== 'undefined') {
    RecommendationEngine.trackCartAdd(name, price, image);
  }
  // Refresh cart display if on cart page
  if (document.getElementById('cartItems')) {
    loadCart();
  }
}

/* =========================
   TOAST NOTIFICATION
========================= */
function showToast(msg) {
  let toast = document.getElementById('cartToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'cartToast';
    toast.style.cssText = 'position:fixed;bottom:30px;left:20px;background:#3b15e3;color:#fff;padding:14px 28px;border-radius:12px;font-size:14px;font-weight:600;z-index:9999;opacity:0;transition:opacity 0.3s;pointer-events:none;box-shadow:0 8px 30px rgba(59,21,227,0.4);max-width:calc(100vw - 40px);word-break:break-word;';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.style.opacity = '1';
  setTimeout(() => { toast.style.opacity = '0'; }, 2000);
}

/* =========================
   UPDATE CART BADGE
========================= */
function updateCartCount() {
  let count = cart.reduce((sum, item) => sum + item.quantity, 0);
  let badges = document.querySelectorAll('#cartCount');
  badges.forEach(b => { b.textContent = count; });
}

/* =========================
   LOAD CART (on cart page)
========================= */
function loadCart() {
  updateCartCount();
  let container = document.getElementById('cartItems');
  if (!container) return;

  let titleEl = document.getElementById('cartCountTitle');
  if (titleEl) {
    let totalItems = cart.reduce((s, i) => s + i.quantity, 0);
    titleEl.textContent = totalItems + ' Items selected';
  }

  if (cart.length === 0) {
    container.innerHTML = `
      <div class="bg-[#1c1a27] rounded-2xl p-12 text-center">
        <i class="fa-solid fa-cart-shopping text-5xl text-gray-600 mb-4"></i>
        <h3 class="text-xl font-bold text-white mb-2">Your cart is empty</h3>
        <p class="text-gray-400 text-sm mb-6">Looks like you haven't added anything yet.</p>
        <a href="4.shop.html" class="bg-[#3b15e3] hover:bg-[#4f2cf7] text-white font-bold py-3 px-8 rounded-xl inline-block transition">Start Shopping</a>
      </div>`;
    updateSummary();
    return;
  }

  container.innerHTML = cart.map((item, i) => `
    <div class="bg-[#1c1a27] rounded-2xl p-5 flex items-center gap-5 group hover:bg-[#221f33] transition">
      <div class="w-20 h-20 rounded-xl overflow-hidden bg-[#252332] flex-shrink-0">
        <img src="imgs/${item.image}" class="w-full h-full object-cover" onerror="this.style.display='none'">
      </div>
      <div class="flex-1 min-w-0">
        <h3 class="text-white font-bold text-base truncate">${item.name}</h3>
        <p class="text-[#3b15e3] font-bold text-sm mt-1">₹${item.price.toLocaleString('en-IN')}</p>
      </div>
      <div class="flex items-center gap-3 bg-[#0b0914] rounded-xl px-3 py-2">
        <button onclick="changeQty(${i}, -1)" class="text-gray-400 hover:text-white text-lg font-bold w-7 h-7 flex items-center justify-center rounded-lg hover:bg-[#252332] transition border-none bg-transparent cursor-pointer">−</button>
        <span class="text-white font-bold text-sm min-w-[20px] text-center">${item.quantity}</span>
        <button onclick="changeQty(${i}, 1)" class="text-gray-400 hover:text-white text-lg font-bold w-7 h-7 flex items-center justify-center rounded-lg hover:bg-[#252332] transition border-none bg-transparent cursor-pointer">+</button>
      </div>
      <p class="text-white font-bold text-base min-w-[80px] text-right">₹${(item.price * item.quantity).toLocaleString('en-IN')}</p>
      <button onclick="removeItem(${i})" class="text-gray-500 hover:text-red-500 transition text-lg border-none bg-transparent cursor-pointer" title="Remove">
        <i class="fa-solid fa-trash-can"></i>
      </button>
    </div>
  `).join('');

  updateSummary();
}

/* =========================
   CART ITEM CONTROLS
========================= */
function changeQty(index, delta) {
  cart[index].quantity += delta;
  if (cart[index].quantity <= 0) cart.splice(index, 1);
  saveCart();
  loadCart();
}

function removeItem(index) {
  cart.splice(index, 1);
  saveCart();
  loadCart();
}

/* =========================
   ORDER SUMMARY
========================= */
let appliedDiscount = 0;

function updateSummary() {
  let subtotal = cart.reduce((sum, i) => sum + i.price * i.quantity, 0);
  let total = subtotal - appliedDiscount;
  if (total < 0) total = 0;

  let el = (id) => document.getElementById(id);
  if (el('subtotalPrice')) el('subtotalPrice').textContent = subtotal.toLocaleString('en-IN', { minimumFractionDigits: 2 });
  if (el('summaryTotal')) el('summaryTotal').textContent = total.toLocaleString('en-IN', { minimumFractionDigits: 2 });
  if (el('upiAmount')) el('upiAmount').textContent = total.toLocaleString('en-IN', { minimumFractionDigits: 2 });
  if (el('codAmount')) el('codAmount').textContent = total.toLocaleString('en-IN', { minimumFractionDigits: 2 });
  if (el('netBankingAmount')) el('netBankingAmount').textContent = total.toLocaleString('en-IN', { minimumFractionDigits: 2 });
  if (el('cardAmount')) el('cardAmount').textContent = total.toLocaleString('en-IN', { minimumFractionDigits: 2 });
  updateDeliveryEstimate(total);
}

function updateDeliveryEstimate(totalAmount) {
  const estimateEl = document.getElementById('deliveryEstimateValue');
  if (!estimateEl) return;

  const amount = Math.max(0, Number(totalAmount) || 0);
  if (amount >= 2000) {
    estimateEl.textContent = 'Tomorrow (Priority Delivery)';
  } else if (amount >= 700) {
    estimateEl.textContent = '2-3 Business Days';
  } else {
    estimateEl.textContent = '3-5 Business Days';
  }
}

function showPromoFeedback(message, type) {
  const el = document.getElementById('promoFeedback');
  if (!el) return;

  el.textContent = message || '';
  el.classList.remove('text-red-400', 'text-green-400', 'text-gray-400');
  if (type === 'error') {
    el.classList.add('text-red-400');
  } else if (type === 'success') {
    el.classList.add('text-green-400');
  } else {
    el.classList.add('text-gray-400');
  }
}

/* =========================
   PROMO CODE
========================= */
function applyPromo() {
  let code = (document.getElementById('promoCode').value || '').trim().toUpperCase();
  let promos = {
    'SAVE10': { percent: 10, label: '10% OFF' },
    'FLAT100': { flat: 100, label: '₹100 OFF' },
    'ROMUYKS100': { flat: 100, label: '₹100 OFF' },
    'ROMUYKS': { percent: 15, label: '15% OFF' }
  };
  let promo = promos[code];
  if (!promo) {
    showToast('Invalid coupon code');
    showPromoFeedback('Coupon not recognized. Try SAVE10, FLAT100, ROMUYKS100, or ROMUYKS.', 'error');
    trackAnalyticsEvent('coupon_apply_failed', { code });
    return;
  }

  let subtotal = cart.reduce((sum, i) => sum + i.price * i.quantity, 0);
  if (promo.percent) appliedDiscount = Math.round(subtotal * promo.percent / 100);
  else if (promo.flat) appliedDiscount = promo.flat;

  let row = document.getElementById('discountRow');
  if (row) {
    row.classList.remove('hidden');
    let nameEl = document.getElementById('discountName');
    if (nameEl) nameEl.textContent = '(' + promo.label + ')';
  }
  let amtEl = document.getElementById('discountAmount');
  if (amtEl) amtEl.textContent = appliedDiscount.toLocaleString('en-IN', { minimumFractionDigits: 2 });

  updateSummary();
  showToast('Coupon applied: ' + promo.label);
  showPromoFeedback(`Coupon applied successfully. You saved ₹${appliedDiscount.toLocaleString('en-IN')}.`, 'success');
  trackAnalyticsEvent('coupon_applied', {
    code,
    discountAmount: appliedDiscount,
    label: promo.label
  });
}

/* =========================
   PAYMENT UI HELPERS
========================= */
function hideAllPayPanels() {
  ['upiBox', 'codBox', 'netBankingBox', 'cardBox'].forEach(id => {
    let el = document.getElementById(id);
    if (el) {
      el.style.display = '';
      el.classList.remove('active-pay-panel');
      el.classList.add('pay-panel', 'hidden');
    }
  });
}

function updateActiveTab(index) {
  let tabs = document.querySelectorAll('.pay-tab');
  tabs.forEach((tab, idx) => {
    const isActive = idx === index;
    tab.classList.toggle('active', isActive);
    tab.setAttribute('aria-selected', String(isActive));
    tab.setAttribute('tabindex', isActive ? '0' : '-1');
  });

  // Update "Other Payment Options" visibility
  let others = document.querySelectorAll('#otherPaymentOptionsSection .grid > div');
  // Show all, then hide the one matching the active tab
  others.forEach(el => el.style.display = 'flex');
  // Map tab index -> other payment option to hide
  // 0=UPI (no entry in others), 1=COD(index 2), 2=NetBanking(index 0), 3=Card(index 1)
  let hideMap = { 0: -1, 1: 2, 2: 0, 3: 1 };
  let hideIdx = hideMap[index];
  if (hideIdx >= 0 && others[hideIdx]) others[hideIdx].style.display = 'none';
}

function showPanel(id, tabIndex) {
  if (cart.length === 0) {
    showToast('Your cart is empty!');    return;
  }
  if (!paymentUnlocked) {
    if (!validateBillingForm()) {
      scrollToBilling();
      return;
    }
    unlockPaymentSection();
  }
  hideAllPayPanels();
  let el = document.getElementById(id);
  if (el) {
    el.classList.remove('pay-panel', 'hidden');
    el.classList.add('active-pay-panel');
    el.style.display = '';
  }
  updateActiveTab(tabIndex);
  updateSummary();
}

/* =========================
   UPI
========================= */
function showUPI() {
  showPanel('upiBox', 0);
  updateUPIQR();
}

function updateUPIQR() {
  let qrEl = document.getElementById('upiQR');
  if (!qrEl) return;

  let total = cart.reduce((sum, i) => sum + i.price * i.quantity, 0) - appliedDiscount;
  if (total < 0) total = 0;

  let upiLink = 'upi://pay?pa=neelvaghasiya6265-1@oksbi' +
    '&pn=Neel%20Vaghasiya' +
    '&am=' + total +
    '&cu=INR' +
    '&tn=Roumyks%20Order';

  qrEl.src = 'https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=' + encodeURIComponent(upiLink);
}

/* =========================
   OTHER PAYMENT METHODS
========================= */
function showCOD() { showPanel('codBox', 1); }
function showNetBanking() { showPanel('netBankingBox', 2); }
function showCard() { showPanel('cardBox', 3); }

/* =========================
   BILLING ADDRESS
========================= */
function getBillingAddress() {
  return {
    firstName: (document.getElementById('billFirstName') || {}).value || '',
    lastName: (document.getElementById('billLastName') || {}).value || '',
    email: (document.getElementById('billEmail') || {}).value || '',
    phone: (document.getElementById('billPhone') || {}).value || '',
    country: (document.getElementById('billCountry') || {}).value || '',
    address: (document.getElementById('billAddress') || {}).value || '',
    city: (document.getElementById('billCity') || {}).value || '',
    state: (document.getElementById('billState') || {}).value || '',
    zip: (document.getElementById('billZip') || {}).value || '',
    shipSameAddress: (document.getElementById('shipSameAddress') || {}).checked || false
  };
}

function validateBillingForm() {
  const form = document.getElementById('billingForm');
  if (!form) return false;

  if (!form.checkValidity()) {
    form.reportValidity();
    showToast('Please fill all billing address fields first.');
    return false;
  }

  return true;
}

function scrollToBilling() {
  const billingSection = document.getElementById('billingSection') || document.querySelector('.billing-section');
  if (billingSection) {
    billingSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function unlockPaymentSection() {
  const paySection = document.getElementById('paymentSection');
  if (!paySection) return;

  paySection.style.display = '';
  paymentUnlocked = true;
}

async function proceedToCheckout() {
  if (cart.length === 0) {
    showToast('Your cart is empty!');
    return;
  }

  const subtotal = cart.reduce((sum, i) => sum + i.price * i.quantity, 0);
  trackAnalyticsEvent('checkout_started', {
    itemCount: cart.reduce((sum, i) => sum + i.quantity, 0),
    subtotal,
    discount: appliedDiscount,
    total: Math.max(0, subtotal - appliedDiscount)
  });

  await applyProfileBillingAddress();
  scrollToBilling();
}

function continueToBilling() {
  if (!validateBillingForm()) {
    scrollToBilling();
    return;
  }

  saveBillingAddressToStorage(getBillingAddress());

  unlockPaymentSection();
  const paySection = document.getElementById('paymentSection');
  if (paySection) paySection.scrollIntoView({ behavior: 'smooth', block: 'start' });

  // Open UPI as default once payment step is unlocked.
  showUPI();
}

/* =========================
   PLACE ORDER
========================= */
async function placeOrder(method) {
  if (cart.length === 0) {
    showToast('Your cart is empty!');
    return;
  }

  if (!validateBillingForm()) {
    scrollToBilling();
    return;
  }

  const billingAddress = getBillingAddress();
  saveBillingAddressToStorage(billingAddress);

  let total = cart.reduce((sum, i) => sum + i.price * i.quantity, 0) - appliedDiscount;
  if (total < 0) total = 0;

  let token = localStorage.getItem('token');

  if (method === 'UPI') {
    await startUpiPayment(token);
    return;
  }

  if (token) {
    try {
      let res = await fetch('http://localhost:5000/api/orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + token
        },
        body: JSON.stringify({
          items: cart,
          totalAmount: total,
          paymentMethod: method,
          billingAddress
        })
      });
      let data = await res.json();
      if (res.ok) {
        orderSuccess(method);
      } else {
        showToast(data.error || 'Order failed');
      }
    } catch (err) {
      // Server not reachable — save locally
      saveOrderLocally(method, total);
      orderSuccess(method);
    }
  } else {
    // Not logged in — save locally
    saveOrderLocally(method, total);
    orderSuccess(method);
  }
}

async function startUpiPayment(token) {
  if (!token) {
    showToast('Please login to pay via UPI QR.');
    return;
  }

  try {
    const response = await fetch('http://localhost:5000/api/payments/upi/initiate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token
      },
      body: JSON.stringify({
        items: cart,
        billingAddress: getBillingAddress()
      })
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || data.message || 'Failed to start UPI payment');
    }

    const qrEl = document.getElementById('upiQR');
    if (qrEl && data.upiPayload) {
      qrEl.src = 'https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=' + encodeURIComponent(data.upiPayload);
    }

    showToast('Scan QR and pay. We will verify payment automatically.');
    beginPaymentStatusPolling(data.orderId, token);
  } catch (err) {
    showToast(err.message || 'Unable to start UPI payment');
  }
}

function beginPaymentStatusPolling(orderId, token) {
  if (upiStatusPollTimer) {
    clearInterval(upiStatusPollTimer);
    upiStatusPollTimer = null;
  }

  const checkStatus = async () => {
    try {
      const response = await fetch(`http://localhost:5000/api/payments/orders/${orderId}/status`, {
        method: 'GET',
        headers: {
          'Authorization': 'Bearer ' + token
        }
      });

      const data = await response.json();
      if (!response.ok) return;

      if (data.paymentStatus === 'paid') {
        clearInterval(upiStatusPollTimer);
        upiStatusPollTimer = null;
        orderSuccess('UPI');
      } else if (data.paymentStatus === 'failed') {
        clearInterval(upiStatusPollTimer);
        upiStatusPollTimer = null;
        showToast('UPI payment failed. Please try again.');
      }
    } catch (err) {
      // Keep polling quietly for transient network errors.
    }
  };

  checkStatus();
  upiStatusPollTimer = setInterval(checkStatus, 5000);
}

function saveOrderLocally(method, total) {
  let orders = JSON.parse(localStorage.getItem('orders') || '[]');
  orders.push({
    items: [...cart],
    totalAmount: total,
    paymentMethod: method,
    billingAddress: getBillingAddress(),
    status: 'Pending',
    createdAt: new Date().toISOString()
  });
  localStorage.setItem('orders', JSON.stringify(orders));
}

function orderSuccess(method) {
  // Track purchase in recommendation engine
  if (typeof RecommendationEngine !== 'undefined') {
    RecommendationEngine.trackPurchase(cart);
  }
  cart = [];
  saveCart();
  trackAnalyticsEvent('order_placed', {
    paymentMethod: method,
    discountApplied: appliedDiscount
  });
  showToast('Order placed via ' + method + '! Payment is pending verification.');
  setTimeout(() => { window.location.href = '7.orders.html'; }, 1500);
}

/* =========================
   INIT
========================= */
updateCartCount();

// On cart page: generate QR and update amounts on load
window.addEventListener('DOMContentLoaded', function() {
  highlightActiveNavbarLink();
  optimizeNonCriticalImages();

  const promoInput = document.getElementById('promoCode');
  if (promoInput) {
    promoInput.addEventListener('input', () => {
      if (!String(promoInput.value || '').trim()) {
        showPromoFeedback('Have a coupon? Enter it above and click Apply.', 'neutral');
      }
    });
  }

  if (document.getElementById('upiBox')) {
    updateSummary();
    updateUPIQR();
  }

  initializeBillingLocationSelectors();
  applySavedBillingAddress();
  applyProfileBillingAddress();

  // Load cart page recommendations
  if (typeof RecommendationEngine !== 'undefined' && document.getElementById('recCartAlsoBought')) {
    RecommendationEngine.loadCartRecommendations();
  }
});
