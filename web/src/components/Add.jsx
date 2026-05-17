import React, {useState, useContext} from 'react'
import api from '../api'
import {Button, Card} from '@heroui/react'
import PlainInput from '../ui/PlainInput'
import {ThemeContext} from '../App'

export default function Add(){
  const {isDark} = useContext(ThemeContext)
  const [sku, setSku] = useState('')
  const [qty, setQty] = useState(1)
  const [status, setStatus] = useState('')
  const [statusType, setStatusType] = useState('') // 'success', 'error'
  const [loading, setLoading] = useState(false)

  const fieldHelp = {
    sku: 'Scan a barcode or enter a SKU to add to inventory',
    qty: 'How many units to add'
  }

  async function submit(e){
    e && e.preventDefault()
    if (!sku.trim()) {
      setStatus('Please enter a SKU or barcode')
      setStatusType('error')
      return
    }

    setLoading(true)
    try{
      const res = await api.addStock(sku, Number(qty))
      if (res && res.sku) {
        setStatus(`Added ${res.quantity} of ${res.sku}`)
        setStatusType('success')
        setSku('')
        setQty(1)
        // Auto-focus for scanner workflow
        setTimeout(() => {
          document.querySelector('[data-focus-add]')?.focus()
        }, 100)
      } else {
        setStatus('Error: Invalid response')
        setStatusType('error')
      }
    }catch(err){ 
      setStatus(err.message || 'Network error')
      setStatusType('error')
    }
    setLoading(false)
  }

  return (
    <Card className={`w-full ${isDark ? 'bg-slate-800 text-white' : ''}`}>
      <div className="gap-6 p-8">
        <h2 className={`text-2xl font-bold ${isDark ? 'text-white' : 'text-slate-900'}`}>Add Stock</h2>
        
        <form onSubmit={submit} className="space-y-4">
          <div className="relative group">
            <PlainInput
              data-focus-add
              type="text"
              label="SKU or Barcode"
              placeholder="Scan or type SKU"
              title="Scan a barcode or enter a SKU to add to inventory"
              value={sku}
              onValueChange={setSku}
              autoFocus
              isDisabled={loading}
              isClearable
              onClear={() => setSku('')}
            />
            <div className={`absolute left-0 bottom-full mb-2 hidden group-hover:block p-2 rounded text-xs z-10 whitespace-nowrap ${isDark ? 'bg-slate-600 text-white' : 'bg-slate-700 text-white'}`}>
              {fieldHelp.sku}
            </div>
          </div>
          
          <div className="relative group">
            <PlainInput
              type="number"
              label="Quantity"
              placeholder="1"
              title="How many units to add"
              value={String(qty)}
              onValueChange={(v) => setQty(Number(v) || 1)}
              min="1"
              isDisabled={loading}
            />
            <div className={`absolute left-0 bottom-full mb-2 hidden group-hover:block p-2 rounded text-xs z-10 whitespace-nowrap ${isDark ? 'bg-slate-600 text-white' : 'bg-slate-700 text-white'}`}>
              {fieldHelp.qty}
            </div>
          </div>
          
          <div className="flex gap-3 pt-4">
            <Button 
              color="primary" 
              type="submit"
              isLoading={loading}
              size="lg"
              className="font-semibold"
            >
              Add Stock
            </Button>
            <Button 
              variant="bordered" 
              onClick={() => {
                setSku('')
                setQty(1)
                setStatus('')
                setStatusType('')
              }}
              isDisabled={loading}
              size="lg"
            >
              Clear
            </Button>
          </div>
        </form>

        {status && (
          <div className={`p-4 rounded-lg ${statusType === 'success' ? (isDark ? 'bg-green-900 border border-green-600 text-green-200' : 'bg-green-50 border border-green-200 text-green-700') : (isDark ? 'bg-red-900 border border-red-600 text-red-200' : 'bg-red-50 border border-red-200 text-red-700')}`}>
            {status}
          </div>
        )}
      </div>
    </Card>
  )
}
