// Minimal API wrapper using Basic Auth password stored in sessionStorage (mirrors previous behavior)
function authHeader(){
  const pwd = sessionStorage.getItem('authPassword') || '20037'
  return { 'Authorization': 'Basic ' + btoa(':' + pwd), 'Content-Type': 'application/json' }
}

export async function ping(){
  const r = await fetch('/ping', { headers: authHeader() })
  return r.text()
}

export async function searchItems(q){
  const r = await fetch('/api/items?q=' + encodeURIComponent(q||''), { headers: authHeader() })
  if (!r.ok) throw new Error('search failed')
  return r.json()
}

export async function addStock(sku, qty){
  const r = await fetch('/api/items', { method:'POST', headers: authHeader(), body: JSON.stringify({sku,quantity:qty}) })
  return r.json()
}

export async function checkout(sku, qty, project){
  const r = await fetch('/api/checkout', { method:'POST', headers: authHeader(), body: JSON.stringify({sku,quantity:qty,project}) })
  if (!r.ok) throw new Error('checkout failed')
  return r.json()
}

export async function getCheckouts(q, project){
  const url = '/api/checkouts?sku=' + encodeURIComponent(q||'') + '&project=' + encodeURIComponent(project||'')
  const r = await fetch(url, { headers: authHeader() })
  if (!r.ok) throw new Error('fetch checkouts failed')
  return r.json()
}

export async function createOrder(name, lines){
  const r = await fetch('/api/orders', { method:'POST', headers: authHeader(), body: JSON.stringify({name,lines}) })
  if (!r.ok) throw new Error('create order failed')
  return r.json()
}

export async function listOrders(status){
  const r = await fetch('/api/orders?status=' + encodeURIComponent(status||''), { headers: authHeader() })
  if (!r.ok) throw new Error('list orders failed')
  return r.json()
}

export async function receiveLine(line_id, quantity){
  const r = await fetch('/api/orders/receive', { method:'POST', headers: authHeader(), body: JSON.stringify({line_id,quantity}) })
  if (!r.ok) throw new Error('receive failed')
  return r.json()
}

export async function createCustomProduct(body){
  const r = await fetch('/api/items/custom', { method:'POST', headers: authHeader(), body: JSON.stringify(body) })
  if (!r.ok) throw new Error('create product failed')
  return r.json()
}

export default { ping, searchItems, addStock, checkout, getCheckouts, createOrder, listOrders, receiveLine, createCustomProduct }
