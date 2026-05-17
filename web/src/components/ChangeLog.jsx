import React, {useState, useEffect, useContext} from 'react'
import api from '../api'
import {Card, Button} from '@heroui/react'
import {ThemeContext} from '../App'

export default function ChangeLog(){
  const {isDark} = useContext(ThemeContext)
  const [checkouts, setCheckouts] = useState([])
  const [loading, setLoading] = useState(false)
  const [filterProject, setFilterProject] = useState('')
  const [filterSku, setFilterSku] = useState('')

  useEffect(() => { load() }, [])

  async function load(){
    setLoading(true)
    try{
      const res = await api.getCheckouts(filterSku, filterProject)
      setCheckouts(res || [])
    }catch(err){ 
      setCheckouts([])
      console.error('Failed to load changelog:', err)
    }
    setLoading(false)
  }

  const actionColors = {
    add: 'text-green-600',
    checkout: 'text-orange-600',
    receive: 'text-blue-600'
  }

  const actionLabels = {
    add: 'Added',
    checkout: 'Checked Out',
    receive: 'Received'
  }

  return (
    <Card className={`w-full ${isDark ? 'bg-slate-800 text-white' : ''}`}>
      <div className="gap-6 p-8">
        <h2 className={`text-2xl font-bold ${isDark ? 'text-white' : 'text-slate-900'}`}>Change Log</h2>
        
        <div className="flex gap-3 items-end flex-wrap">
          <div>
            <label className={`text-sm mb-1 block ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>Filter by SKU</label>
            <input
              type="text"
              placeholder="Leave empty for all"
              value={filterSku}
              onChange={(e) => setFilterSku(e.target.value)}
              className={`px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-300 ${isDark ? 'bg-slate-700 text-white border-slate-600 placeholder-slate-400' : 'bg-white text-slate-900 border-slate-200 placeholder-slate-400'}`}
            />
          </div>
          <div>
            <label className={`text-sm mb-1 block ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>Filter by Project</label>
            <input
              type="text"
              placeholder="Leave empty for all"
              value={filterProject}
              onChange={(e) => setFilterProject(e.target.value)}
              className={`px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-300 ${isDark ? 'bg-slate-700 text-white border-slate-600 placeholder-slate-400' : 'bg-white text-slate-900 border-slate-200 placeholder-slate-400'}`}
            />
          </div>
          <Button 
            onClick={() => load()}
            isLoading={loading}
            color="primary"
          >
            Search
          </Button>
          <Button 
            onClick={() => {
              setFilterSku('')
              setFilterProject('')
              load()
            }}
            variant="bordered"
          >
            Clear
          </Button>
        </div>

        {loading && (
          <div className={`flex justify-center py-8 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
            Loading change log...
          </div>
        )}

        {!loading && checkouts.length === 0 && (
          <div className={`text-center py-12 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
            No changes found
          </div>
        )}

        {!loading && checkouts.length > 0 && (
          <div className="space-y-3 mt-6">
            {checkouts.map((entry, idx) => (
              <div 
                key={idx}
                className={`p-4 border rounded-lg ${isDark ? 'border-slate-700 bg-slate-700' : 'border-slate-200 bg-slate-50'}`}
              >
                <div className="flex justify-between items-start mb-2">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-1">
                      <span className={`font-semibold text-sm ${actionColors[entry.action] || 'text-slate-600'}`}>
                        {actionLabels[entry.action] || entry.action}
                      </span>
                      <span className="font-mono font-bold text-blue-600">{entry.sku}</span>
                      <span className={`text-sm font-semibold ${entry.quantity > 0 ? 'text-green-600' : 'text-orange-600'}`}>
                        {entry.quantity > 0 ? '+' : ''}{entry.quantity}
                      </span>
                    </div>
                    {entry.project && (
                      <p className={`text-sm ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                        Project: {entry.project}
                      </p>
                    )}
                  </div>
                  <span className={`text-xs ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                    {new Date(entry.created_at).toLocaleString()}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  )
}
