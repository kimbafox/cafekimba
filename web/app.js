const $ = (selector) => document.querySelector(selector);
const money = (value) => `Bs ${Number(value).toFixed(2).replace('.', ',')}`;
let products = [];
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/La_Paz' });

async function request(path, options) {
  const response = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...options });
  const body = response.status === 204 ? null : await response.json();
  if (!response.ok) throw new Error(body?.error ?? 'No se pudo completar la acción.');
  return body;
}
function metric(title, period) {
  const percentage = period.goal ? Math.min(100, (period.total / period.goal) * 100) : 100;
  const difference = period.total - period.goal;
  return `<article class="metric"><p>${title}</p><h3>${money(period.total)}</h3><small>Meta: ${money(period.goal)} · ${difference >= 0 ? 'Superado por' : 'Faltan'} ${money(Math.abs(difference))}</small><div class="progress"><i style="width:${percentage}%"></i></div></article>`;
}
function render(data) {
  $('#metrics').innerHTML = metric('HOY · MÍNIMO Bs 300', data.today) + metric('SEMANA · LUNES A SÁBADO', data.week) + metric('MES · LUNES A SÁBADO', data.month);
  $('#order-count').textContent = `${data.latestSales.length} pedidos recientes`;
  $('#orders').innerHTML = data.latestSales.length ? data.latestSales.map((sale) => `<tr><td>${new Date(sale.createdAt).toLocaleTimeString('es-BO',{hour:'2-digit',minute:'2-digit'})}</td><td>${sale.items.map(i=>`${i.quantity}× ${i.product.name}`).join(' · ')}</td><td class="processed">● Procesado</td><td><b>${money(sale.total)}</b></td></tr>`).join('') : '<tr><td colspan="4">Aún no hay pedidos registrados.</td></tr>';
  $('#products').innerHTML = products.map((product) => `<article class="product"><div class="info"><b>${product.name}</b><small>${product.category} · ${money(product.price)}</small></div><button class="icon" data-edit="${product.id}" title="Editar">✎</button></article>`).join('');
  document.querySelectorAll('[data-edit]').forEach((button) => button.onclick = () => openEditor(products.find(p => p.id === button.dataset.edit)));
  $('#updated').textContent = `Actualizado a las ${new Date().toLocaleTimeString('es-BO',{hour:'2-digit',minute:'2-digit'})}. Se actualiza cada 10 segundos.`;
}
async function refresh() {
  try {
    const [data, menu] = await Promise.all([request(`/api/admin/overview?date=${today}`), request('/api/products')]);
    products = menu; render(data); $('#connection').textContent = '● En vivo'; $('#connection').className = 'live';
  } catch (error) { $('#connection').textContent = `● ${error.message}`; $('#connection').className = ''; }
}
function openEditor(product) {
  $('#product-form').reset(); $('#form-error').textContent = ''; $('#product-id').value = product?.id ?? '';
  $('#form-title').textContent = product ? 'Editar producto' : 'Agregar producto';
  $('#name').value = product?.name ?? ''; $('#price').value = product?.price ?? ''; $('#category').value = product?.category ?? 'Bebidas calientes'; $('#editor').showModal();
}
$('#add-product').onclick = () => openEditor();
$('#refresh').onclick = refresh;
$('#product-form').addEventListener('submit', async (event) => {
  event.preventDefault(); const id = $('#product-id').value; const payload = { name: $('#name').value.trim(), price: Number($('#price').value), category: $('#category').value };
  try { await request(id ? `/api/products/${id}` : '/api/products', { method: id ? 'PUT' : 'POST', body: JSON.stringify(payload) }); $('#editor').close(); refresh(); }
  catch (error) { $('#form-error').textContent = error.message; }
});
refresh(); setInterval(refresh, 10000);
