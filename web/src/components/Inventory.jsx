import React, {useState, useEffect, useContext} from 'react'
import api from '../api'
import {Card, Button} from '@heroui/react'
import PlainInput from '../ui/PlainInput'
import {MagnifyingGlassIcon} from '@radix-ui/react-icons'
import {ThemeContext} from '../App'
import {applyInventoryFilters, fakeLoadingMessages, parseInventoryQuery} from '../lib/easterEggs'

export default function Inventory(){
  const {isDark, isNightShift, focusInventorySearch} = useContext(ThemeContext)
  const [q, setQ] = useState('')
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [selectedItem, setSelectedItem] = useState(null)
  const [notice, setNotice] = useState('')
  const [loadingMessage, setLoadingMessage] = useState(fakeLoadingMessages[0])

  useEffect(() => { 
    const t = setTimeout(() => load(q), 250)
    return () => clearTimeout(t)
  }, [q])

  useEffect(() => {
    if (!loading) return
    let index = 0
    setLoadingMessage(fakeLoadingMessages[0])
    const timer = setInterval(() => {
      index = (index + 1) % fakeLoadingMessages.length
      setLoadingMessage(fakeLoadingMessages[index])
    }, 1000)
    return () => clearInterval(timer)
  }, [loading])

  async function load(query = q){
    const parsed = parseInventoryQuery(query)

    if (parsed.mode === 'denied') {
      setItems([])
      setNotice(parsed.message)
      setLoading(false)
      return
    }

    setLoading(true)
    setNotice(parsed.mode === 'help' ? parsed.message : '')
    try{
      const res = await api.searchItems(parsed.baseQuery)
      setItems(applyInventoryFilters(res || [], parsed.filters))
    }catch(err){ 
      setItems([])
      console.error('Search failed:', err)
    }
    setLoading(false)
  }

  return (
    <Card className={`w-full ${isNightShift ? 'bg-black text-green-100 border border-green-900' : isDark ? 'bg-slate-800 text-white' : ''}`}>
      <div className="gap-6 p-8">
        <h2 className={`text-2xl font-bold ${isNightShift ? 'text-green-100' : isDark ? 'text-white' : 'text-slate-900'}`}>Inventory</h2>
        
        <div className="flex gap-3 items-end">
          <div className="flex-1">
            <div className={`text-sm mb-2 ${isNightShift ? 'text-green-300' : isDark ? 'text-slate-300' : 'text-slate-600'}`}>
              Search by SKU, barcode, title, or shortcuts like qty:&lt;10, expired:true, location:Aisle-4. Type help for advanced filters.
            </div>
            <PlainInput
              data-inventory-search
              isClearable
              type="text"
              label="Search"
              placeholder="SKU, barcode, or title..."
              value={q}
              onValueChange={setQ}
              onClear={() => setQ('')}
              startContent={<MagnifyingGlassIcon className="w-4 h-4 text-slate-400" />}
            />
          </div>
          <Button 
            isIconOnly 
            variant="bordered"
            onClick={() => load()}
            size="lg"
            className={isDark ? 'text-white' : ''}
            title="Refresh inventory"
          >
            ↻
          </Button>
        </div>

        {loading && (
          <div className={`flex justify-center py-8 ${isNightShift ? 'text-green-300' : isDark ? 'text-slate-400' : 'text-slate-500'}`}>
            {loadingMessage}
          </div>
        )}

        {notice && !loading && (
          <div className={`mt-4 p-3 rounded-lg ${notice === 'Permission denied' ? (isNightShift ? 'bg-red-950 border border-red-700 text-red-200' : 'bg-red-100 border border-red-200 text-red-700') : (isNightShift ? 'bg-green-950 border border-green-700 text-green-200' : 'bg-slate-100 border border-slate-200 text-slate-700')}`}>
            {notice}
          </div>
        )}

        {!loading && items.length === 0 && (
          <div className={`text-center py-12 ${isNightShift ? 'text-green-300' : isDark ? 'text-slate-400' : 'text-slate-500'}`}>
            {q ? 'No items found' : 'Enter a search term to view inventory'}
          </div>
        )}

        {!loading && items.length > 0 && (
          <div className="space-y-3 mt-6">
            {items.map((item) => (
              <div 
                key={item.sku} 
                onClick={() => setSelectedItem(item)}
                className={`flex justify-between items-center p-4 border rounded-lg cursor-pointer transition ${isDark ? 'border-slate-700 hover:bg-slate-700' : 'border-slate-200 hover:bg-slate-50'}`}
              >
                <div className="flex-1">
                  <p className="font-mono font-bold text-blue-600">{item.sku}</p>
                  <p className={`text-sm ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>{item.title}</p>
                </div>
                <div className="text-right">
                  <span className={`text-lg font-bold ${item.quantity > 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {item.quantity}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Item Detail Modal */}
      {selectedItem && (
        <div 
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-2"
          onClick={() => setSelectedItem(null)}
        >
          <Card 
            className={`w-full max-w-6xl max-h-[95vh] overflow-y-auto ${isNightShift ? 'bg-black text-green-100 border border-green-900' : isDark ? 'bg-slate-800 text-white' : ''}`}
            onClick={e => e.stopPropagation()}
          >
            <div className="p-8">
              <div className="flex justify-between items-start mb-8">
                <div className="flex-1">
                  <h2 className={`text-4xl font-bold mb-3 ${isDark ? 'text-white' : 'text-slate-900'}`}>{selectedItem.title}</h2>
                  <p className={`text-xl font-mono mb-1 ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>{selectedItem.sku}</p>
                </div>
                <Button isIconOnly variant="light" onClick={() => setSelectedItem(null)} className={isNightShift ? 'text-green-200' : isDark ? 'text-white' : ''}>x</Button>
              </div>

              <div className={`grid grid-cols-1 lg:grid-cols-3 gap-8 ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
                {/* Left column: Info */}
                <div className="lg:col-span-1 space-y-6">
                  {selectedItem.barcode && (
                    <div>
                      <strong>Barcode:</strong> <span className="font-mono text-sm block mt-1">{selectedItem.barcode}</span>
                    </div>
                  )}
                  <div>
                    <strong>On Hand:</strong> <span className={selectedItem.quantity > 0 ? 'text-green-600 font-bold text-2xl' : 'text-red-600 font-bold text-2xl'}>{selectedItem.quantity}</span>
                  </div>
                  {selectedItem.on_order > 0 && (
                    <div>
                      <strong>On Order:</strong> <span className="text-blue-600 font-bold text-2xl">{selectedItem.on_order}</span>
                    </div>
                  )}
                  {selectedItem.product_url && (
                    <div>
                      <a href={selectedItem.product_url} target="_blank" rel="noopener noreferrer" className="text-blue-500 underline hover:text-blue-600 text-sm break-all">
                        View Product Link
                      </a>
                    </div>
                  )}
                </div>

                {/* Right column: Images (2 columns) */}
                {(selectedItem.image_url || selectedItem.images?.length > 0) && (
                  <div className="lg:col-span-2">
                    <strong className="block mb-4 text-lg">Images</strong>
                    <div className="grid grid-cols-2 gap-4">
                      {/* Show image_url if it exists (for backward compatibility) */}
                      {selectedItem.image_url && (
                        <div className={`rounded border overflow-hidden ${isDark ? 'border-slate-600' : 'border-slate-200'}`}>
                          <img src={selectedItem.image_url} alt={selectedItem.title} className="w-full h-64 object-cover" onError={(e) => e.target.src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="100" height="100"%3E%3Crect fill="%23ddd" width="100" height="100"/%3E%3C/svg%3E'} />
                        </div>
                      )}
                      {/* Show all images from images array */}
                      {selectedItem.images && selectedItem.images.map((img, idx) => (
                        <div key={idx} className={`rounded border overflow-hidden ${isDark ? 'border-slate-600' : 'border-slate-200'}`}>
                          <img src={img} alt={`${selectedItem.title} ${idx+1}`} className="w-full h-64 object-cover" onError={(e) => e.target.src = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="100" height="100"%3E%3Crect fill="%23ddd" width="100" height="100"/%3E%3C/svg%3E'} />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </Card>
        </div>
      )}
    </Card>
  )
}
