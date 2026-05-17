import React, {useState, useContext} from 'react'
import api from '../api'
import {Button, Card} from '@heroui/react'
import PlainInput from '../ui/PlainInput'
import {ThemeContext} from '../App'

export default function NewProduct(){
  const {isDark} = useContext(ThemeContext)
  const [sku, setSku] = useState('')
  const [barcode, setBarcode] = useState('')
  const [title, setTitle] = useState('')
  const [images, setImages] = useState([])
  const [imageInput, setImageInput] = useState('')
  const [productUrl, setProductUrl] = useState('')
  const [quantity, setQuantity] = useState('0')
  const [packSize, setPackSize] = useState('1')
  const [status, setStatus] = useState('')
  const [statusType, setStatusType] = useState('')
  const [loading, setLoading] = useState(false)
  const [helpFor, setHelpFor] = useState(null)

  const fieldHelp = {
    sku: 'Unique identifier for the product (will be converted to uppercase)',
    barcode: 'Optional barcode for scanner input',
    title: 'Product name and description',
    images: 'Product images - add multiple URLs. Image data from GoBILDA may populate automatically',
    productUrl: 'Link to the product page',
    quantity: 'Starting inventory level',
    packSize: 'Default pack/unit size'
  }

  function addImage(){
    if (imageInput.trim() && !images.includes(imageInput.trim())) {
      setImages([...images, imageInput.trim()])
      setImageInput('')
    }
  }

  function removeImage(idx){
    setImages(images.filter((_, i) => i !== idx))
  }

  async function submit(e){
    e && e.preventDefault()
    
    if (!sku.trim() || !title.trim()) {
      setStatus('SKU and Title are required')
      setStatusType('error')
      return
    }

    setLoading(true)
    try{
      const res = await api.createCustomProduct({
        sku: sku.toUpperCase(),
        barcode,
        title,
        images: images.length > 0 ? images : [],
        product_url: productUrl,
        quantity: Number(quantity),
        pack_size: Number(packSize)
      })
      
      if (res && res.sku) {
        setStatus(`Created product ${res.sku}`)
        setStatusType('success')
        setSku('')
        setBarcode('')
        setTitle('')
        setImages([])
        setImageInput('')
        setProductUrl('')
        setQuantity('0')
        setPackSize('1')
        setTimeout(() => {
          document.querySelector('[data-focus-newprod]')?.focus()
        }, 100)
      } else {
        setStatus('Error: Could not create product')
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
        <h2 className={`text-2xl font-bold ${isDark ? 'text-white' : 'text-slate-900'}`}>Create New Product</h2>
        
        <form onSubmit={submit} className="space-y-4">
          {/* SKU & Barcode */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="relative group">
              <PlainInput
                data-focus-newprod
                type="text"
                label="SKU"
                placeholder="e.g., PART-001"
                title="Unique identifier for the product (will be converted to uppercase)"
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
                type="text"
                label="Barcode"
                placeholder="(optional)"
                title="Optional barcode for scanner input"
                value={barcode}
                onValueChange={setBarcode}
                isDisabled={loading}
                isClearable
                onClear={() => setBarcode('')}
              />
              <div className={`absolute left-0 bottom-full mb-2 hidden group-hover:block p-2 rounded text-xs z-10 whitespace-nowrap ${isDark ? 'bg-slate-600 text-white' : 'bg-slate-700 text-white'}`}>
                {fieldHelp.barcode}
              </div>
            </div>
          </div>

          {/* Title */}
          <div className="relative group">
            <PlainInput
              type="text"
              label="Product Title"
              placeholder="e.g., Aluminum Channel 1x1"
              title="Product name and description"
              value={title}
              onValueChange={setTitle}
              isDisabled={loading}
              isClearable
              onClear={() => setTitle('')}
            />
            <div className={`absolute left-0 bottom-full mb-2 hidden group-hover:block p-2 rounded text-xs z-10 ${isDark ? 'bg-slate-600 text-white' : 'bg-slate-700 text-white'}`}>
              {fieldHelp.title}
            </div>
          </div>

          {/* Images */}
          <div className="relative group">
            <label className={`text-sm mb-2 block ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>Product Images</label>
            <div className="flex gap-2 mb-2">
              <PlainInput
                type="url"
                placeholder="https://..."
                value={imageInput}
                onValueChange={setImageInput}
                isDisabled={loading}
                className="flex-1"
              />
              <Button 
                type="button"
                onClick={addImage}
                isDisabled={loading || !imageInput.trim()}
                size="sm"
              >
                Add Image
              </Button>
            </div>
            {images.length > 0 && (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mb-3">
                {images.map((img, idx) => (
                  <div key={idx} className={`relative group/img rounded border p-2 ${isDark ? 'border-slate-600 bg-slate-700' : 'border-slate-200 bg-slate-50'}`}>
                    <img src={img} alt={`Image ${idx+1}`} className="w-full h-20 object-cover rounded" onError={(e) => e.target.src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="100" height="100"%3E%3Crect fill="%23ddd" width="100" height="100"/%3E%3C/svg%3E'} />
                    <button 
                      type="button"
                      onClick={() => removeImage(idx)}
                      className={`absolute top-1 right-1 opacity-0 group-hover/img:opacity-100 px-2 py-1 rounded text-xs ${isDark ? 'bg-red-600 text-white' : 'bg-red-100 text-red-700'}`}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className={`absolute left-0 bottom-full mb-2 hidden group-hover:block p-2 rounded text-xs z-10 ${isDark ? 'bg-slate-600 text-white' : 'bg-slate-700 text-white'}`}>
              {fieldHelp.images}
            </div>
          </div>

          {/* Product URL */}
          <div className="relative group">
            <PlainInput
              type="url"
              label="Product URL"
              placeholder="https://..."
              title="Link to the product page"
              value={productUrl}
              onValueChange={setProductUrl}
              isDisabled={loading}
              isClearable
              onClear={() => setProductUrl('')}
            />
            <div className={`absolute left-0 bottom-full mb-2 hidden group-hover:block p-2 rounded text-xs z-10 whitespace-nowrap ${isDark ? 'bg-slate-600 text-white' : 'bg-slate-700 text-white'}`}>
              {fieldHelp.productUrl}
            </div>
          </div>

          {/* Quantity & Pack Size */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="relative group">
              <PlainInput
                type="number"
                label="Initial Quantity"
                placeholder="0"
                title="Starting inventory level"
                value={quantity}
                onValueChange={setQuantity}
                isDisabled={loading}
              />
              <div className={`absolute left-0 bottom-full mb-2 hidden group-hover:block p-2 rounded text-xs z-10 whitespace-nowrap ${isDark ? 'bg-slate-600 text-white' : 'bg-slate-700 text-white'}`}>
                {fieldHelp.quantity}
              </div>
            </div>
            
            <div className="relative group">
              <PlainInput
                type="number"
                label="Pack Size"
                placeholder="1"
                title="Default pack/unit size"
                value={packSize}
                onValueChange={setPackSize}
                isDisabled={loading}
              />
              <div className={`absolute left-0 bottom-full mb-2 hidden group-hover:block p-2 rounded text-xs z-10 whitespace-nowrap ${isDark ? 'bg-slate-600 text-white' : 'bg-slate-700 text-white'}`}>
                {fieldHelp.packSize}
              </div>
            </div>
          </div>

          <div className="flex gap-3 pt-4">
            <Button 
              color="success" 
              type="submit"
              isLoading={loading}
              size="lg"
              className="font-semibold"
            >
              Create Product
            </Button>
            <Button 
              variant="bordered" 
              onClick={() => {
                setSku('')
                setBarcode('')
                setTitle('')
                setImages([])
                setImageInput('')
                setProductUrl('')
                setQuantity('0')
                setPackSize('1')
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
