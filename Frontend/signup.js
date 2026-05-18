(() => {
const signupForm = document.getElementById("signupForm");
const signupInlineError = document.getElementById("signupInlineError");
const signupSubmitBtn = document.getElementById("signupSubmitBtn");
const otpDeliveryPreferenceField = document.getElementById("otpDeliveryPreferenceField");
const signupOtpModal = document.getElementById("signupOtpModal");
const signupOtpSubtitle = document.getElementById("signupOtpSubtitle");
const signupOtpDestination = document.getElementById("signupOtpDestination");
const signupOtpStatus = document.getElementById("signupOtpStatus");
const signupOtpExpiry = document.getElementById("signupOtpExpiry");
const signupOtpError = document.getElementById("signupOtpError");
const signupOtpVerifyBtn = document.getElementById("signupOtpVerifyBtn");
const signupOtpResendBtn = document.getElementById("signupOtpResendBtn");
const signupOtpBackBtn = document.getElementById("signupOtpBackBtn");
const signupOtpDigits = Array.from(document.querySelectorAll("[data-otp-digit]"));
const signupOtpStorageKey = "romuyksPendingSignupOtp";

let signupOtpTimer = null;
let pendingSignupOtpState = null;
let isSendingSignupOtp = false;
let isVerifyingSignupOtp = false;
let isResendingSignupOtp = false;

function trackSignupAnalytics(eventName, metadata) {
  if (typeof window.trackAnalyticsEvent === "function") {
    window.trackAnalyticsEvent(eventName, metadata || {});
  }
}

function initializeSignupLocationSelectors() {
  if (typeof window.initializeWorldLocationSelectors !== "function") return;

  window.initializeWorldLocationSelectors({
    countrySelectId: "signupCountry",
    stateSelectId: "signupState",
    countryCodeSelectId: "signupCountryCode",
    defaultCountry: "India",
    defaultCountryCode: "+91"
  });
}

document.addEventListener("DOMContentLoaded", initializeSignupLocationSelectors);

function showSignupInlineError(message) {
  if (!signupInlineError) return;
  signupInlineError.textContent = message;
  signupInlineError.style.setProperty("color", "#FCA5A5", "important");
  signupInlineError.classList.add("show");
}

function clearSignupInlineError() {
  if (!signupInlineError) return;
  signupInlineError.textContent = "";
  signupInlineError.classList.remove("show");
}

function showSignupOtpError(message) {
  if (!signupOtpError) return;
  signupOtpError.textContent = message;
}

function clearSignupOtpError() {
  if (!signupOtpError) return;
  signupOtpError.textContent = "";
}

function setSignupButtonLoading(loading) {
  if (!signupSubmitBtn) return;
  signupSubmitBtn.disabled = loading;
  signupSubmitBtn.textContent = loading ? "SENDING OTP..." : "CREATE ACCOUNT";
}

function setOtpActionLoading(button, loading, loadingText, defaultText) {
  if (!button) return;
  button.disabled = loading;
  button.textContent = loading ? loadingText : defaultText;
}

function setOtpDigitsDisabled(disabled) {
  signupOtpDigits.forEach((input) => {
    input.disabled = disabled;
  });
}

function clearOtpDigits() {
  signupOtpDigits.forEach((input) => {
    input.value = "";
  });
  if (signupOtpDigits[0]) {
    signupOtpDigits[0].focus();
  }
}

function getOtpCode() {
  return signupOtpDigits.map((input) => String(input.value || "").trim()).join("");
}

function getSignupFormPayload() {
  if (!signupForm) return null;

  const formData = new FormData(signupForm);
  const payload = Object.fromEntries(formData.entries());

  const name = String(payload.name || "").trim();
  const email = String(payload.email || "").trim();
  const password = String(payload.password || "").trim();
  const streetAddress = String(payload.streetAddress || "").trim();
  const district = String(payload.district || "").trim();
  const state = String(payload.state || "").trim();
  const country = String(payload.country || "").trim();
  const pincode = String(payload.pincode || "").trim();
  const mobileNumber = String(payload.mobileNumber || "").trim();
  const countryCode = String(payload.countryCode || "+91").trim() || "+91";
  const gender = String(payload.gender || "").trim();
  const otpDeliveryPreference = String(payload.otpDeliveryPreference || "email").trim() || "email";
  const addressParts = [streetAddress, district, state, country, pincode].filter(Boolean);

  return {
    name,
    email,
    password,
    otpDeliveryPreference,
    countryCode,
    mobileNumber,
    streetAddress,
    country,
    state,
    district,
    pincode,
    gender,
    address: addressParts.join(", ")
  };
}

function validateSignupPayload(payload) {
  if (!payload) return "Fill in the required account details.";
  if (!payload.name || !payload.email || !payload.password) {
    return "Fill in the required account details.";
  }
  return "";
}

function formatCountdown(msRemaining) {
  const safeMs = Math.max(0, msRemaining);
  const totalSeconds = Math.ceil(safeMs / 1000);
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function savePendingSignupOtpState(state) {
  pendingSignupOtpState = state;
  try {
    sessionStorage.setItem(signupOtpStorageKey, JSON.stringify(state));
  } catch (error) {
    // Ignore storage failures.
  }
}

function loadPendingSignupOtpState() {
  try {
    const raw = sessionStorage.getItem(signupOtpStorageKey);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (error) {
    return null;
  }
}

function clearPendingSignupOtpState() {
  pendingSignupOtpState = null;
  try {
    sessionStorage.removeItem(signupOtpStorageKey);
  } catch (error) {
    // Ignore storage failures.
  }
}

function updateSignupOtpTimer() {
  if (!signupOtpExpiry || !pendingSignupOtpState) return;

  const remaining = pendingSignupOtpState.expiresAt - Date.now();
  if (remaining <= 0) {
    signupOtpExpiry.textContent = "Code expired. Resend to continue.";
    signupOtpExpiry.style.color = "#fca5a5";
    return;
  }

  signupOtpExpiry.style.color = "#a1a1aa";
  signupOtpExpiry.textContent = `Expires in ${formatCountdown(remaining)}`;
}

function startSignupOtpTimer() {
  stopSignupOtpTimer();
  updateSignupOtpTimer();
  signupOtpTimer = window.setInterval(updateSignupOtpTimer, 1000);
}

function stopSignupOtpTimer() {
  if (signupOtpTimer) {
    clearInterval(signupOtpTimer);
    signupOtpTimer = null;
  }
}

function setSignupOtpChannelText(channel, destination) {
  if (signupOtpSubtitle) {
    signupOtpSubtitle.textContent = channel === "sms"
      ? "Enter the OTP sent to your mobile number"
      : "Enter the OTP sent to your email";
  }

  if (signupOtpDestination) {
    signupOtpDestination.textContent = destination || "";
  }

  if (signupOtpStatus) {
    signupOtpStatus.textContent = "Verification Code Sent";
  }
}

function openSignupOtpModal(state) {
  if (!signupOtpModal || !state) return;

  savePendingSignupOtpState(state);
  setSignupOtpChannelText(state.channel, state.destination);
  clearSignupOtpError();
  clearOtpDigits();
  setOtpDigitsDisabled(false);
  signupOtpModal.classList.add("show");
  signupOtpModal.setAttribute("aria-hidden", "false");
  document.body.classList.add("otp-modal-open");
  startSignupOtpTimer();
}

function closeSignupOtpModal(options = {}) {
  const preserveState = options.preserveState !== false;
  if (!signupOtpModal) return;

  signupOtpModal.classList.remove("show");
  signupOtpModal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("otp-modal-open");
  stopSignupOtpTimer();
  clearSignupOtpError();
  setOtpActionLoading(signupOtpVerifyBtn, false, "Verifying...", "Verify OTP");
  setOtpActionLoading(signupOtpResendBtn, false, "Resending...", "Resend Code");
  setOtpDigitsDisabled(false);

  if (!preserveState) {
    clearPendingSignupOtpState();
  }
}

function focusOtpDigit(index) {
  const nextInput = signupOtpDigits[index];
  if (nextInput) {
    nextInput.focus();
    nextInput.select();
  }
}

function isOtpComplete() {
  return getOtpCode().length === signupOtpDigits.length;
}

async function sendSignupOtp(payload) {
  const res = await fetch("http://localhost:5000/api/auth/signup/send-otp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  let data = {};
  try {
    data = await res.json();
  } catch (error) {
    data = {};
  }

  return { res, data };
}

async function verifySignupOtp() {
  if (!pendingSignupOtpState || isVerifyingSignupOtp) return;

  const otp = getOtpCode();
  if (otp.length !== signupOtpDigits.length) {
    showSignupOtpError("Enter the 6-digit OTP.");
    return;
  }

  isVerifyingSignupOtp = true;
  clearSignupOtpError();
  setOtpActionLoading(signupOtpVerifyBtn, true, "Verifying...", "Verify OTP");
  setOtpDigitsDisabled(true);

  try {
    const response = await fetch("http://localhost:5000/api/auth/signup/verify-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requestId: pendingSignupOtpState.requestId,
        otp
      })
    });

    const data = await response.json();

    if (response.ok) {
      trackSignupAnalytics("otp_verified", {
        channel: pendingSignupOtpState.channel || "email"
      });

      clearPendingSignupOtpState();
      stopSignupOtpTimer();
      signupForm.reset();
      initializeSignupLocationSelectors();

      if (otpDeliveryPreferenceField) {
        otpDeliveryPreferenceField.value = "email";
      }

      if (data.token) {
        localStorage.setItem("token", data.token);
      }

      trackSignupAnalytics("signup_completed", {
        channel: pendingSignupOtpState?.channel || "email"
      });

      closeSignupOtpModal({ preserveState: false });
      window.location.href = "9.dashboard.html";
      return;
    }

    showSignupOtpError(data.message || "Invalid OTP. Please try again.");
    clearOtpDigits();
  } catch (error) {
    showSignupOtpError("Server error. Please try again later.");
  } finally {
    isVerifyingSignupOtp = false;
    setOtpActionLoading(signupOtpVerifyBtn, false, "Verifying...", "Verify OTP");
    setOtpDigitsDisabled(false);
  }
}

async function resendSignupOtp() {
  if (!pendingSignupOtpState || isResendingSignupOtp) return;

  isResendingSignupOtp = true;
  clearSignupOtpError();
  setOtpActionLoading(signupOtpResendBtn, true, "Resending...", "Resend Code");

  try {
    const response = await fetch("http://localhost:5000/api/auth/signup/resend-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId: pendingSignupOtpState.requestId })
    });

    const data = await response.json();

    if (response.ok) {
      trackSignupAnalytics("otp_resent", {
        channel: pendingSignupOtpState.channel || "email"
      });

      savePendingSignupOtpState({
        ...pendingSignupOtpState,
        requestId: data.requestId || pendingSignupOtpState.requestId,
        channel: data.channel || pendingSignupOtpState.channel,
        destination: data.destination || pendingSignupOtpState.destination,
        expiresAt: Date.now() + ((data.expiresInSeconds || 300) * 1000)
      });
      updateSignupOtpTimer();
      clearOtpDigits();
      showSignupOtpError("");
      return;
    }

    showSignupOtpError(data.message || "Could not resend OTP.");
  } catch (error) {
    showSignupOtpError("Server error. Please try again later.");
  } finally {
    isResendingSignupOtp = false;
    setOtpActionLoading(signupOtpResendBtn, false, "Resending...", "Resend Code");
  }
}

function restorePendingSignupOtpState() {
  const savedState = loadPendingSignupOtpState();
  if (!savedState || !savedState.requestId || !savedState.expiresAt || savedState.expiresAt <= Date.now()) {
    clearPendingSignupOtpState();
    return;
  }

  pendingSignupOtpState = savedState;
  openSignupOtpModal(savedState);
}

if (signupOtpDigits.length) {
  signupOtpDigits.forEach((input, index) => {
    input.addEventListener("input", (event) => {
      const value = String(event.target.value || "").replace(/\D/g, "").slice(0, 1);
      event.target.value = value;

      if (value && index < signupOtpDigits.length - 1) {
        focusOtpDigit(index + 1);
      }

      if (isOtpComplete() && !isVerifyingSignupOtp) {
        verifySignupOtp();
      }
    });

    input.addEventListener("keydown", (event) => {
      if (event.key === "Backspace" && !event.target.value && index > 0) {
        focusOtpDigit(index - 1);
      }
      if (event.key === "Enter") {
        event.preventDefault();
        verifySignupOtp();
      }
    });

    input.addEventListener("paste", (event) => {
      event.preventDefault();
      const pastedValue = String(event.clipboardData.getData("text") || "").replace(/\D/g, "").slice(0, signupOtpDigits.length);
      if (!pastedValue) return;

      pastedValue.split("").forEach((digit, digitIndex) => {
        if (signupOtpDigits[digitIndex]) {
          signupOtpDigits[digitIndex].value = digit;
        }
      });

      const nextEmpty = signupOtpDigits.findIndex((digitInput) => !digitInput.value);
      if (nextEmpty >= 0) {
        focusOtpDigit(nextEmpty);
      }

      if (isOtpComplete() && !isVerifyingSignupOtp) {
        verifySignupOtp();
      }
    });
  });
}

if (signupOtpVerifyBtn) {
  signupOtpVerifyBtn.addEventListener("click", verifySignupOtp);
}

if (signupOtpResendBtn) {
  signupOtpResendBtn.addEventListener("click", resendSignupOtp);
}

if (signupOtpBackBtn) {
  signupOtpBackBtn.addEventListener("click", () => {
    clearPendingSignupOtpState();
    closeSignupOtpModal({ preserveState: false });
  });
}

if (signupOtpModal) {
  signupOtpModal.addEventListener("click", (event) => {
    if (event.target === signupOtpModal) {
      closeSignupOtpModal({ preserveState: true });
    }
  });
}

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && signupOtpModal && signupOtpModal.classList.contains("show")) {
    closeSignupOtpModal({ preserveState: true });
  }
});

if (signupForm) {
  signupForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearSignupInlineError();

    const payload = getSignupFormPayload();
    const validationMessage = validateSignupPayload(payload);
    if (validationMessage) {
      showSignupInlineError(validationMessage);
      return;
    }

    const streetAddress = String(payload.streetAddress || "").trim();
    const district = String(payload.district || "").trim();
    const state = String(payload.state || "").trim();
    const country = String(payload.country || "").trim();
    const pincode = String(payload.pincode || "").trim();

    if (!streetAddress || !district || !state || !country || !pincode) {
      showSignupInlineError("Please complete all required details before creating your account.");
      return;
    }

    isSendingSignupOtp = true;
    setSignupButtonLoading(true);

    trackSignupAnalytics("signup_started", {
      channel: payload.otpDeliveryPreference || "email"
    });

    try {
      const { res, data } = await sendSignupOtp(payload);

      if (res.ok) {
        trackSignupAnalytics("otp_sent", {
          channel: data.channel || payload.otpDeliveryPreference || "email"
        });

        const requestState = {
          requestId: data.requestId,
          channel: data.channel || payload.otpDeliveryPreference,
          destination: data.maskedDestination || data.destination || "",
          expiresAt: Date.now() + ((data.expiresInSeconds || 300) * 1000)
        };

        openSignupOtpModal(requestState);
        return;
      }

      const message = String(data?.message || "").toLowerCase();
      if (res.status === 409 || message.includes("already")) {
        showSignupInlineError("An account with this email already exists.");
      } else if (Array.isArray(data?.missingFields) && data.missingFields.length) {
        showSignupInlineError("Please complete all required signup details.");
      } else {
        showSignupInlineError(data.message || "Signup failed. Please try again.");
      }
    } catch (error) {
      showSignupInlineError("Server error. Please try again later.");
    } finally {
      isSendingSignupOtp = false;
      setSignupButtonLoading(false);
    }
  });
}

restorePendingSignupOtpState();
})();
