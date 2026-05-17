import React, {useState, useEffect, useContext} from 'react'
import api from '../api'
import {Card, Button} from '@heroui/react'
import PlainInput from '../ui/PlainInput'
import {ThemeContext} from '../App'

export default function Orders(){
  const {isDark} = useContext(ThemeContext)
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(false)
  const [showAddOrder, setShowAddOrder] = useState(false)
  const [orderName, setOrderName] = useState('')
  const [orderLines, setOrderLines] = useState([{sku: '', qty: 1}])
  const [addStatus, setAddStatus] = useState('')
  const [addLoading, setAddLoading] = useState(false)

  const fieldHelp = {
    orderName: 'A name or reference for this purchase order',
    sku: 'Product SKU or barcode',
    qty: 'Quantity expected for this line item'
  }

  useEffect(() => { load() }, [])

  async function load(){
    setLoading(true)
    try{
      const res = await api.listOrders('open')
      setOrders(res || [])
    }catch(err){ 
      setOrders([])
      console.error('Failed to load orders:', err)
    }
    setLoading(false)
  }

  async function receive(lineId, qty){
    try{
      await api.receiveLine(lineId, qty)
      await load()
    }catch(err){ 
      console.error('Receive failed:', err)
      alert('Failed to receive: ' + (err.message || 'Unknown error'))
    }
  }

  async function submitOrder(e){
    e && e.preventDefault()
    if (!orderName.trim()) {
      setAddStatus('Please enter an order name')
      return
    }
    if (!orderLines.some(l => l.sku.trim())) {
      setAddStatus('Please add at least one item')
      return
    }
    setAddLoading(true)
    try{
      const lines = orderLines.filter(l => l.sku.trim()).map(l => ({sku: l.sku.toUpperCase(), quantity: Number(l.qty) || 1}))
      const res = await api.createOrder(orderName, lines)
      if (res && res.id) {
        setAddStatus(`Order created (ID: ${res.id})`)
        setOrderName('')
        setOrderLines([{sku: '', qty: 1}])
        setTimeout(() => {
          setShowAddOrder(false)
          setAddStatus('')
          load()
        }, 1000)
      } else {
        setAddStatus('Error: Could not create order')
      }
    }catch(err){
      setAddStatus('Error: ' + err.message)
    }
    setAddLoading(false)
  }

  return (
    <Card className={`w-full ${isDark ? 'bg-slate-800 text-white' : ''}`}>
      <div className="gap-6 p-8">
        <div className="flex justify-between items-center">
          <h2 className={`text-2xl font-bold ${isDark ? 'text-white' : 'text-slate-900'}`}>Purchase Orders</h2>
          <div className="flex gap-2">
            <Button 
              onClick={() => setShowAddOrder(!showAddOrder)}
              color={showAddOrder ? 'warning' : 'primary'}
              size="lg"
            >
              {showAddOrder ? 'Cancel' : 'New Order'}
            </Button>
            <Button 
              isIconOnly 
              variant="bordered"
              onClick={() => load()}
              size="lg"
              isLoading={loading}
              className={isDark ? 'text-white' : ''}
              title="Refresh orders"
            >
              ↻
            </Button>
          </div>
        </div>

        {/* Create Order Form */}
        {showAddOrder && (
          <div className={`p-4 rounded-lg border ${isDark ? 'border-slate-700 bg-slate-700' : 'border-slate-200 bg-slate-50'}`}>
            <h3 className={`font-semibold mb-4 ${isDark ? 'text-white' : 'text-slate-900'}`}>Create New Order</h3>
            <form onSubmit={submitOrder} className="space-y-4">
              <div className="relative group">
                <PlainInput
                  label="Order Name"
                  placeholder="e.g., GoBILDA March 2026"
                  title="A name or reference for this purchase order"
                  value={orderName}
                  onValueChange={setOrderName}
                  isDisabled={addLoading}
                />
                <div className={`absolute left-0 bottom-full mb-2 hidden group-hover:block p-2 rounded text-xs z-10 ${isDark ? 'bg-slate-600 text-white' : 'bg-slate-700 text-white'}`}>
                  {fieldHelp.orderName}
                </div>
              </div>
              
              <div>
                <label className={`text-sm mb-2 block ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>Line Items</label>
                {orderLines.map((line, idx) => (
                  <div key={idx} className="flex gap-2 mb-2">
                    <div className="flex-1 relative group">
                      <PlainInput
                        placeholder="SKU or Barcode"
                        title="Product SKU or barcode"
                        value={line.sku}
                        onValueChange={(v) => {
                          const newLines = [...orderLines]
                          newLines[idx].sku = v
                          setOrderLines(newLines)
                        }}
                        isDisabled={addLoading}
                      />
                      <div className={`absolute left-0 bottom-full mb-2 hidden group-hover:block p-2 rounded text-xs z-10 whitespace-nowrap ${isDark ? 'bg-slate-600 text-white' : 'bg-slate-700 text-white'}`}>
                        {fieldHelp.sku}
                      </div>
                    </div>
                    <div className="w-20 relative group">
                      <PlainInput
                        type="number"
                        placeholder="Qty"
                        title="Quantity expected for this line item"
                        value={String(line.qty)}
                        onValueChange={(v) => {
                          const newLines = [...orderLines]
                          newLines[idx].qty = Number(v) || 1
                          setOrderLines(newLines)
                        }}
                        min="1"
                        isDisabled={addLoading}
                      />
                      <div className={`absolute left-0 bottom-full mb-2 hidden group-hover:block p-2 rounded text-xs z-10 whitespace-nowrap ${isDark ? 'bg-slate-600 text-white' : 'bg-slate-700 text-white'}`}>
                        {fieldHelp.qty}
                      </div>
                    </div>
                    {orderLines.length > 1 && (
                      <Button
                        size="sm"
                        color="danger"
                        onClick={() => setOrderLines(orderLines.filter((_, i) => i !== idx))}
                        isDisabled={addLoading}
                      >
                        Remove
                      </Button>
                    )}
                  </div>
                ))}
              </div>

              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="bordered"
                  onClick={() => setOrderLines([...orderLines, {sku: '', qty: 1}])}
                  isDisabled={addLoading}
                  size="sm"
                >
                  Add Line
                </Button>
                <Button
                  type="submit"
                  color="success"
                  isLoading={addLoading}
                >
                  Create Order
                </Button>
              </div>

              {addStatus && (
                <div className={`p-3 rounded ${addStatus.includes('created') ? (isDark ? 'bg-green-900 border border-green-600 text-green-200' : 'bg-green-100 text-green-700') : (isDark ? 'bg-red-900 border border-red-600 text-red-200' : 'bg-red-100 text-red-700')}`}>
                  {addStatus}
                </div>
              )}
            </form>
          </div>
        )}

        {loading && (
          <div className={`flex justify-center py-8 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
            Loading orders...
          </div>
        )}

        {!loading && orders.length === 0 && (
          <div className={`text-center py-12 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
            No open purchase orders
          </div>
        )}

        {!loading && orders.map((order) => (
          <div key={order.id} className={`border rounded-lg p-4 space-y-3 ${isDark ? 'border-slate-700' : 'border-slate-200'}`}>
            <div className="flex items-center justify-between">
              <div>
                <h3 className={`text-xl font-bold ${isDark ? 'text-white' : 'text-slate-900'}`}>{order.name}</h3>
                <p className={`text-sm ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>Order #{order.id}</p>
              </div>
              <span className={`text-sm font-semibold px-3 py-1 rounded-full ${order.status === 'open' ? 'bg-yellow-100 text-yellow-800' : 'bg-green-100 text-green-800'}`}>
                {order.status}
              </span>
            </div>

            <div className="space-y-2">
              {order.lines.map((line) => {
                const remaining = line.quantity - (line.received || 0)
                return (
                  <div key={line.id} className={`flex justify-between items-center p-3 rounded border ${isDark ? 'bg-slate-700 border-slate-600' : 'bg-slate-50 border-slate-100'}`}>
                    <div className="flex-1">
                      <p className="font-mono font-semibold text-blue-600">{line.sku}</p>
                      <p className={`text-sm ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>Expected: {line.quantity} | Received: {line.received || 0}</p>
                    </div>
                    <Button
                      size="sm"
                      color={remaining > 0 ? 'primary' : 'success'}
                      isDisabled={remaining <= 0}
                      onClick={() => receive(line.id, 1)}
                    >
                      +1 Receive
                    </Button>
                  </div>
                )
              })}
            </div>

            <div className={`border-b ${isDark ? 'border-slate-600' : 'border-slate-200'} my-2`} />
          </div>
        ))}
      </div>
    </Card>
  )
}
