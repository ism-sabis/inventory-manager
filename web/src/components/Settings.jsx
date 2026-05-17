import React, {useContext, useState} from 'react'
import {Button, Card} from '@heroui/react'
import {ThemeContext} from '../App'
import {fakePatchNotes} from '../lib/easterEggs'

export default function Settings(){
  const {isDark, isNightShift, toggleTheme, enableNightShift} = useContext(ThemeContext)
  const [refreshStatus, setRefreshStatus] = useState('')
  const [refreshLoading, setRefreshLoading] = useState(false)
  const [showPatchNotes, setShowPatchNotes] = useState(false)

  async function handleRefresh(){
    setRefreshLoading(true)
    setRefreshStatus('')
    try{
      const pwd = sessionStorage.getItem('authPassword') || '20037'
      const r = await fetch('/api/admin/refresh', {
        method: 'POST',
        headers: {
          'Authorization': 'Basic ' + btoa(':' + pwd),
          'Content-Type': 'application/json'
        }
      })
      if (r.status === 202) {
        setRefreshStatus('Refresh started (runs in background)')
      } else {
        const data = await r.json()
        setRefreshStatus('Error: ' + (data.error || 'Unexpected response'))
      }
    } catch(err) {
      setRefreshStatus('Error: ' + err.message)
    }
    setRefreshLoading(false)
  }

  return (
    <Card className={`w-full ${isNightShift ? 'bg-black text-green-100 border border-green-900' : isDark ? 'bg-slate-800 text-white' : ''}`}>
      <div className="gap-6 p-8">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <h2 className={`text-2xl font-bold ${isNightShift ? 'text-green-100' : isDark ? 'text-white' : 'text-slate-900'}`}>Settings</h2>
          <Button size="sm" variant="light" className={isNightShift ? 'text-green-300' : ''} onClick={() => setShowPatchNotes(true)}>
            Version v2.7.0
          </Button>
        </div>
        
        <div className="space-y-6 mt-6">
          {/* Dark Mode Toggle */}
          <div className={`p-4 rounded-lg border ${isNightShift ? 'border-green-900 bg-black' : isDark ? 'border-slate-700 bg-slate-700' : 'border-slate-200 bg-slate-50'}`}>
            <div className="flex justify-between items-center">
              <div>
                <h3 className={`font-semibold ${isNightShift ? 'text-green-100' : isDark ? 'text-white' : 'text-slate-900'}`}>Appearance</h3>
                <p className={`text-sm ${isNightShift ? 'text-green-300' : isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                  {isNightShift ? 'Night Shift is enabled' : isDark ? 'Dark mode is enabled' : 'Light mode is enabled'}
                </p>
              </div>
              <Button 
                onClick={toggleTheme}
                color={isNightShift ? 'success' : isDark ? 'warning' : 'default'}
                size="lg"
              >
                {isNightShift ? 'Return to Dark Mode' : isDark ? 'Light Mode' : 'Dark Mode'}
              </Button>
            </div>
            <div className="mt-3">
              <Button size="sm" variant="bordered" onClick={enableNightShift} className={isNightShift ? 'text-green-200 border-green-700' : ''}>
                Night Shift
              </Button>
            </div>
          </div>

          {/* Scraper & Database Refresh */}
          <div className={`p-4 rounded-lg border ${isNightShift ? 'border-green-900 bg-black' : isDark ? 'border-slate-700 bg-slate-700' : 'border-slate-200 bg-slate-50'}`}>
            <div>
              <h3 className={`font-semibold mb-2 ${isNightShift ? 'text-green-100' : isDark ? 'text-white' : 'text-slate-900'}`}>Product Catalog</h3>
              <p className={`text-sm mb-4 ${isNightShift ? 'text-green-300' : isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                Run the GoBILDA scraper to refresh the product catalog and update the database.
              </p>
              <Button 
                onClick={handleRefresh}
                isLoading={refreshLoading}
                color="primary"
                size="lg"
              >
                Refresh Products & Update Database
              </Button>
            </div>
            {refreshStatus && (
              <div className={`mt-4 p-3 rounded ${refreshStatus.startsWith('Refresh') ? (isNightShift ? 'bg-green-950 border border-green-700 text-green-200' : isDark ? 'bg-green-900 border border-green-600 text-green-200' : 'bg-green-100 text-green-700') : (isNightShift ? 'bg-red-950 border border-red-700 text-red-200' : isDark ? 'bg-red-900 border border-red-600 text-red-200' : 'bg-red-100 text-red-700')}`}>
                {refreshStatus}
              </div>
            )}
          </div>
        </div>
      </div>

      {showPatchNotes && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[85] p-4" onClick={() => setShowPatchNotes(false)}>
          <Card className={`w-full max-w-xl ${isNightShift ? 'bg-black text-green-100 border border-green-900' : isDark ? 'bg-slate-800 text-white' : ''}`} onClick={(event) => event.stopPropagation()}>
            <div className="p-6 space-y-4">
              <div className="flex justify-between gap-4 items-start">
                <div>
                  <h3 className="text-2xl font-bold">Version v2.7.0</h3>
                  <p className={isNightShift ? 'text-green-300' : 'text-slate-500'}>Mostly stable. Mildly haunted.</p>
                </div>
                <Button isIconOnly variant="light" className={isNightShift ? 'text-green-200' : ''} onClick={() => setShowPatchNotes(false)}>x</Button>
              </div>
              <ul className="list-disc pl-5 space-y-2">
                {fakePatchNotes.map((note) => <li key={note}>{note}</li>)}
              </ul>
              <div className="flex gap-3 flex-wrap">
                <Button color="success" onClick={enableNightShift}>Enter Night Shift</Button>
                <Button variant="bordered" onClick={() => setShowPatchNotes(false)}>Close</Button>
              </div>
            </div>
          </Card>
        </div>
      )}
    </Card>
  )
}
