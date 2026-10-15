const $ = (selector) => document.querySelector(selector);
const money = (value) => `Bs ${Number(value).toFixed(2).replace('.', ',')}`;
let products = [];
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/La_Paz' });

async function request(path, options = {}) {
  const response = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...options });
  const body = response.status === 204 ? null : await response.json();
  if (!response.ok) throw new Error(body?.error ?? 'No se pudo completar la acción.');
  return body;
}
function metric(title, period) {
  const percentage = period.goal ? Math.min(100, (period.total / period.goal) * 100) : 100;
  const difference = period.total - period.goal;
  return `<article class="metric"><p>${title}</p><h3>${money(period.total)}</h3><small>Meta ${money(period.goal)} · ${difference >= 0 ? 'Superado por' : 'Faltan'} ${money(Math.abs(difference))}</small><div class="progress"><i style="width:${percentage}%"></i></div></article>`;
}
function renderChart(dailySales) {
  const values = new Map(dailySales.map((item) => [item.date, item.total]));
  const now = new Date(`${today}T12:00:00`);
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  const days = [];
  for (let date = new Date(first); date <= now; date.setDate(date.getDate() + 1)) {
    const key = date.toLocaleDateString('en-CA');
    days.push({ label: date.getDate(), total: values.get(key) ?? 0, today: key === today });
  }
  const maximum = Math.max(300, ...days.map((day) => day.total));
  $('#month-chart').innerHTML = days.map((day) => {
    const height = Math.max(2, (day.total / maximum) * 100);
    return `<div class="bar-item ${day.today ? 'today' : ''}" title="${day.label}: ${money(day.total)}"><div class="bar-stack"><i class="bar" style="--height:${height}%;height:${height}%"></i></div><small>${day.label}</small></div>`;
  }).join('');
}
function renderMenu() {
  const categories = ['Bebidas calientes', 'Bebidas frías', 'Sándwiches'];
  $('#products').innerHTML = categories.map((category) => {
    const items = products.filter((product) => product.category === category);
    return `<section class="category-section"><div class="category-title">${category}<span>${items.length} productos</span></div><div class="product-grid">${items.map((product) => `<article class="product"><div class="info"><b>${product.name}</b><small>${money(product.price)}</small></div><button class="icon" data-edit="${product.id}" title="Editar producto">✎</button></article>`).join('') || '<div class="product">Sin productos en esta categoría.</div>'}</div></section>`;
  }).join('');
  document.querySelectorAll('[data-edit]').forEach((button) => button.onclick = () => openEditor(products.find((product) => product.id === button.dataset.edit)));
}
function render(data) {
  $('#metrics').innerHTML = metric('HOY · MÍNIMO BS 300', data.today) + metric('SEMANA · LUNES A SÁBADO', data.week) + metric('MES · LUNES A SÁBADO', data.month);
  $('#order-count').textContent = `${data.latestSales.length} pedidos`;
  $('#orders').innerHTML = data.latestSales.length ? data.latestSales.map((sale) => `<tr><td>${new Date(sale.createdAt).toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' })}</td><td>${sale.items.map((item) => `${item.quantity}× ${item.product.name}`).join(' · ')}</td><td class="processed">● Procesado</td><td><b>${money(sale.total)}</b></td></tr>`).join('') : '<tr><td colspan="4">Aún no hay pedidos registrados.</td></tr>';
  renderChart(data.dailySales); renderMenu();
  $('#updated').textContent = `Actualizado a las ${new Date().toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' })}. Actualización automática cada 10 segundos.`;
}
async function refresh() {
  try {
    const [data, menu] = await Promise.all([request(`/api/admin/overview?date=${today}`), request('/api/products')]);
    products = menu; render(data); $('#connection').textContent = '● En vivo'; $('#connection').className = 'live';
  } catch (error) {
    $('#connection').textContent = `● ${error.message}`; $('#connection').className = '';
    if (error.message.includes('administrador')) window.location.assign('/login');
  }
}
function openEditor(product) {
  $('#product-form').reset(); $('#form-error').textContent = ''; $('#product-id').value = product?.id ?? '';
  $('#form-title').textContent = product ? 'Editar producto' : 'Agregar producto';
  $('#name').value = product?.name ?? ''; $('#price').value = product?.price ?? ''; $('#category').value = product?.category ?? 'Bebidas calientes'; $('#editor').showModal();
}
$('#add-product').onclick = () => openEditor();
$('#refresh').onclick = refresh;
$('#help').onclick = () => $('#guide').showModal();
$('#close-guide').onclick = () => $('#guide').close();
$('#logout').onclick = async () => { await request('/api/logout', { method: 'POST' }); window.location.assign('/login'); };
$('#product-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const id = $('#product-id').value;
  const payload = { name: $('#name').value.trim(), price: Number($('#price').value), category: $('#category').value };
  try {
    await request(id ? `/api/products/${id}` : '/api/products', { method: id ? 'PUT' : 'POST', body: JSON.stringify(payload) });
    $('#editor').close(); refresh();
  } catch (error) { $('#form-error').textContent = error.message; }
});
refresh(); setInterval(refresh, 10000);
