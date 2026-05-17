import React, {useState, useContext} from 'react'
import api from '../api'
import {Button, Card} from '@heroui/react'
import PlainInput from '../ui/PlainInput'
import {ThemeContext} from '../App'

export default function Checkout(){
  const {isDark} = useContext(ThemeContext)
  const [sku, setSku] = useState('')
  const [qty, setQty] = useState(1)
  const [project, setProject] = useState('')
  const [status, setStatus] = useState('')
  const [statusType, setStatusType] = useState('')
  const [loading, setLoading] = useState(false)

  const fieldHelp = {
    sku: 'Scan a barcode or enter a SKU to checkout',
    qty: 'How many units to remove',
    project: 'Project name or context for this checkout'
  }

  async function submit(e){
    e && e.preventDefault()
    if (!sku.trim() || !project.trim()) {
      setStatus('Please enter SKU and project')
      setStatusType('error')
      return
    }

    setLoading(true)
    try{
      const res = await api.checkout(sku, Number(qty), project)
      if (res && res.sku) {
        setStatus(`Checked out ${res.quantity} of ${res.sku} to ${project}`)
        setStatusType('success')
        setSku('')
        setQty(1)
        setProject('')
        setTimeout(() => {
          document.querySelector('[data-focus-checkout]')?.focus()
        }, 100)
      } else {
        setStatus('Error: Could not complete checkout')
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
        <h2 className={`text-2xl font-bold ${isDark ? 'text-white' : 'text-slate-900'}`}>Checkout</h2>
        
        <form onSubmit={submit} className="space-y-4">
          <PlainInput
            data-focus-checkout
            type="text"
            label="SKU or Barcode"
            placeholder="Scan or type SKU"
            value={sku}
            onValueChange={setSku}
            autoFocus
            isDisabled={loading}
            isClearable
            onClear={() => setSku('')}
          />
          
          <PlainInput
            type="number"
            label="Quantity"
            placeholder="1"
            value={String(qty)}
            onValueChange={(v) => setQty(Number(v) || 1)}
            min="1"
            isDisabled={loading}
          />
          
          <PlainInput
            type="text"
            label="Project/Purpose"
            placeholder="e.g., Competition, Build, Testing"
            value={project}
            onValueChange={setProject}
            isDisabled={loading}
            isClearable
            onClear={() => setProject('')}
          />
          
          <div className="flex gap-3 pt-4">
            <Button 
              color="warning" 
              type="submit"
              isLoading={loading}
              size="lg"
              className="font-semibold"
            >
              Checkout
            </Button>
            <Button 
              variant="bordered" 
              onClick={() => {
                setSku('')
                setQty(1)
                setProject('')
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
