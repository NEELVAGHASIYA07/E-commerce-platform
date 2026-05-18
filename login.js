const loginForm = document.getElementById("loginForm");
const loginInlineError = document.getElementById("loginInlineError");

function showLoginInlineError(message) {
  if (!loginInlineError) return;
  loginInlineError.textContent = message;
  loginInlineError.style.setProperty("color", "#FCA5A5", "important");
  loginInlineError.classList.add("show");
}

function clearLoginInlineError() {
  if (!loginInlineError) return;
  loginInlineError.textContent = "";
  loginInlineError.classList.remove("show");
}

if (loginForm) {
  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearLoginInlineError();

    if (loginForm.dataset.mode === "otp") {
      showLoginInlineError("OTP login is not configured yet. Use password login.");
      return;
    }

    const formData = new FormData(loginForm);
    const email = String(formData.get("email") || "").trim();
    const password = String(formData.get("password") || "").trim();

    if (!email || !password) {
      showLoginInlineError("Enter both email and password.");
      return;
    }

    try {
      const res = await fetch("http://localhost:5000/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password })
      });

      const data = await res.json();

      if (res.ok) {
        localStorage.setItem("token", data.token);
        window.location.href = "9.dashboard.html";
      } else {
        showLoginInlineError(data.message || "Invalid email or password.");
      }

    } catch (err) {
      showLoginInlineError("Server error. Please try again later.");
    }
  });
}