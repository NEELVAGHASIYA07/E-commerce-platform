const contactForm = document.querySelector(".contact-form");
if (contactForm) {
  contactForm.addEventListener("submit", async e => {
    e.preventDefault();

    const nameInput = document.getElementById("contactName") || contactForm.querySelector('input[name="name"]') || contactForm.querySelector('input[type="text"]');
    const emailInput = document.getElementById("contactEmail") || contactForm.querySelector('input[name="email"]') || contactForm.querySelector('input[type="email"]');
    const messageInput = document.getElementById("contactMessage") || contactForm.querySelector('textarea[name="message"]') || contactForm.querySelector("textarea");

    const data = {
      name: (nameInput?.value || "").trim(),
      email: (emailInput?.value || "").trim(),
      message: (messageInput?.value || "").trim()
    };

    if (!data.name || !data.email || !data.message) {
      alert("Please fill all fields before sending your message.");
      return;
    }

    try {
      await fetch("http://localhost:5000/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data)
      });

      const successEl = document.getElementById("contactSuccess");
      if (successEl) {
        successEl.style.display = "block";
        setTimeout(() => {
          successEl.style.display = "none";
        }, 3000);
      } else {
        alert("Message sent successfully!");
      }
      e.target.reset();
    } catch (err) {
      alert("Server error. Try again later.");
    }
  });
}
