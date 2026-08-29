---
layout: default
title: Contact
permalink: /contact/
---

## ✉️ Contact

<p class="page-intro" markdown="1">
Get in touch — the message goes straight to my inbox, no email address
shown here.
</p>

<form class="contact-form" action="https://api.web3forms.com/submit" method="POST">
  <input type="hidden" name="access_key" value="c453c230-0238-48bc-8d2f-3214d6c581a8">
  <input type="hidden" name="subject" value="New message from t29mato.github.io">
  <input type="checkbox" name="botcheck" class="contact-honeypot" tabindex="-1" autocomplete="off">

  <label for="contact-name">Name</label>
  <input type="text" id="contact-name" name="name" required>

  <label for="contact-email">Your email</label>
  <input type="email" id="contact-email" name="email" required>

  <label for="contact-message">Message</label>
  <textarea id="contact-message" name="message" rows="6" required></textarea>

  <button type="submit">Send</button>
  <p class="contact-status" data-state="idle"></p>
</form>

<script>
(function () {
  var form = document.querySelector(".contact-form");
  if (!form) return;
  var status = form.querySelector(".contact-status");
  var button = form.querySelector("button");

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    button.disabled = true;
    status.dataset.state = "sending";
    status.textContent = "Sending…";

    fetch(form.action, {
      method: "POST",
      body: new FormData(form),
      headers: { Accept: "application/json" },
    })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (data.success) {
          status.dataset.state = "success";
          status.textContent = "Thanks — message sent.";
          form.reset();
        } else {
          throw new Error(data.message || "Something went wrong.");
        }
      })
      .catch(function () {
        status.dataset.state = "error";
        status.textContent = "Couldn't send that — please try again in a moment.";
      })
      .finally(function () {
        button.disabled = false;
      });
  });
})();
</script>
