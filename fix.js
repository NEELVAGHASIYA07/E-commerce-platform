const fs = require('fs');
let content = fs.readFileSync('cart.js', 'utf8');

const newBlock = /* =========================
   PAYMENT UI HELPERS
========================= */
function hideAll() {
  ['upiBox', 'codBox', 'netBankingBox', 'cardBox'].forEach((id) => {
    let el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
}

function updateActiveTab(index) {
  let tabs = document.querySelectorAll('.pay-tab');
  tabs.forEach(tab => tab.classList.remove('active'));
  if(tabs[index]) tabs[index].classList.add('active');
  
  let otherContainers = document.querySelectorAll('#otherPaymentOptionsSection > div > div');
  if(otherContainers.length >= 3) {
      if(index === 0) {
          otherContainers[0].style.display = 'flex';
          otherContainers[1].style.display = 'flex';
          otherContainers[2].style.display = 'flex';
      } else if (index === 1) {
          otherContainers[0].style.display = 'flex';
          otherContainers[1].style.display = 'flex';
          otherContainers[2].style.display = 'none';
      } else if (index === 2) {
          otherContainers[0].style.display = 'none';
          otherContainers[1].style.display = 'flex';
          otherContainers[2].style.display = 'flex';
      } else if (index === 3) {
          otherContainers[0].style.display = 'flex';
          otherContainers[1].style.display = 'none';
          otherContainers[2].style.display = 'flex';
      }
  }
}

/* =========================
   UPI QR GENERATION
========================= */
function showUPI() {
  hideAll();

  if (!cart || cart.length === 0) {
    alert('Your cart is empty');
    return;
  }

  document.getElementById('upiBox').style.display = 'block';
  updateActiveTab(0);
  updateUPIQR(); 
}

function updateUPIQR() {
  if (
    !document.getElementById('upiBox') ||
    document.getElementById('upiBox').style.display === 'none'
  ) {
    return;
  }

  let total = cart.reduce((sum, i) => sum + i.price * i.quantity, 0);

  document.getElementById('upiAmount').innerText = total.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  let upiLink =
    'upi://pay?pa=neelvaghasiya6265-1@oksbi' +
    '&pn=Neel%20Vaghasiya' +
    '&am=' +
    total +
    '&cu=INR' +
    '&tn=Roumyks%20Order';

  document.getElementById('upiQR').src =
    'https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=' +
    encodeURIComponent(upiLink);
}

/* =========================
   OTHER PAYMENT METHODS
========================= */
function showCOD() {
  hideAll();
  document.getElementById('codBox').style.display = 'block';
  updateActiveTab(1);
}

function showNetBanking() {
  hideAll();
  document.getElementById('netBankingBox').style.display = 'block';
  updateActiveTab(2);
}

function showCard() {
  hideAll();
  document.getElementById('cardBox').style.display = 'block';
  updateActiveTab(3);
};

content = content.replace(/\/\* =========================\r?\n   PAYMENT UI HELPERS[\s\S]*?(?=function confirmCOD)/, newBlock + '\n\n  ');
fs.writeFileSync('cart.js', content, 'utf8');
console.log('Done');
