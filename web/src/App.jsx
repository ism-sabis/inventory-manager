import React, {useState, useEffect, useMemo, useRef, createContext} from 'react'
import {Card, Button} from '@heroui/react'
import Add from './components/Add'
import Inventory from './components/Inventory'
import Checkout from './components/Checkout'
import Orders from './components/Orders'
import NewProduct from './components/NewProduct'
import Settings from './components/Settings'
import ChangeLog from './components/ChangeLog'
import PlainInput from './ui/PlainInput'
import {konamiCode} from './lib/easterEggs'

export const ThemeContext = createContext({isDark: true, isNightShift: false, toggleTheme: () => {}, enableNightShift: () => {}, openPatchNotes: () => {}, openPalette: () => {}, retroEnabled: false})

export default function App(){
  const [activeTab, setActiveTab] = useState('add')
  const [themeMode, setThemeMode] = useState(() => localStorage.getItem('inventoryThemeMode') || 'dark')
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [paletteQuery, setPaletteQuery] = useState('')
  const [patchNotesOpen, setPatchNotesOpen] = useState(false)
  const [retroEnabled, setRetroEnabled] = useState(() => localStorage.getItem('inventoryRetroSounds') === 'true')
  const konamiProgress = useRef(0)

  useEffect(()=>{ document.title = 'Inventory Manager' },[])
  useEffect(() => {
    localStorage.setItem('inventoryThemeMode', themeMode)
  }, [themeMode])
  useEffect(() => {
    localStorage.setItem('inventoryRetroSounds', String(retroEnabled))
  }, [retroEnabled])

  const isNightShift = themeMode === 'nightShift'
  const isDark = themeMode !== 'light'

  function playTone(frequency = 660, duration = 0.05, gainValue = 0.03){
    if (typeof window === 'undefined') return
    const AudioContextClass = window.AudioContext || window.webkitAudioContext
    if (!AudioContextClass) return
    try{
      const audioContext = new AudioContextClass()
      const oscillator = audioContext.createOscillator()
      const gainNode = audioContext.createGain()
      oscillator.type = 'square'
      oscillator.frequency.value = frequency
      gainNode.gain.value = gainValue
      oscillator.connect(gainNode)
      gainNode.connect(audioContext.destination)
      oscillator.start()
      oscillator.stop(audioContext.currentTime + duration)
      oscillator.onended = () => audioContext.close().catch(() => {})
    }catch{
      // Silently ignore audio failures.
    }
  }

  useEffect(() => {
    function handleKeyDown(event){
      const matches = konamiCode[konamiProgress.current]
      if (event.code === matches) {
        konamiProgress.current += 1
        if (konamiProgress.current === konamiCode.length) {
          konamiProgress.current = 0
          setRetroEnabled(true)
          playTone(988, 0.08, 0.04)
        }
      } else {
        konamiProgress.current = event.code === konamiCode[0] ? 1 : 0
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setPaletteOpen((open) => !open)
        setPaletteQuery('')
      }

      if (event.key === 'Escape') {
        setPaletteOpen(false)
        setPatchNotesOpen(false)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  useEffect(() => {
    function handleClick(event){
      if (!retroEnabled) return
      const target = event.target instanceof Element ? event.target.closest('button, [role="button"]') : null
      if (target) {
        playTone(840, 0.03, 0.015)
      }
    }

    document.addEventListener('click', handleClick, true)
    return () => document.removeEventListener('click', handleClick, true)
  }, [retroEnabled])

  const themeShell = isNightShift
    ? 'bg-[radial-gradient(circle_at_top,_rgba(34,197,94,0.12),_transparent_38%),linear-gradient(180deg,#020617_0%,#020202_100%)] text-green-100'
    : isDark
      ? 'bg-gradient-to-br from-slate-900 to-slate-800 text-white'
      : 'bg-gradient-to-br from-slate-100 to-slate-200 text-slate-900'

  const commands = useMemo(() => ([
    {label: 'Open Add Stock', shortcut: '1', action: () => setActiveTab('add')},
    {label: 'Open New Product', shortcut: '2', action: () => setActiveTab('new')},
    {label: 'Open Checkout', shortcut: '3', action: () => setActiveTab('checkout')},
    {label: 'Open Purchase Orders', shortcut: '4', action: () => setActiveTab('orders')},
    {label: 'Open Inventory', shortcut: '5', action: () => setActiveTab('inventory')},
    {label: 'Open Change Log', shortcut: '6', action: () => setActiveTab('changelog')},
    {label: 'Open Settings', shortcut: '7', action: () => setActiveTab('settings')},
    {label: 'Toggle Dark Mode', shortcut: 'Ctrl+Shift+D', action: () => setThemeMode((current) => current === 'light' ? 'dark' : 'light')},
    {label: 'Enter Night Shift', shortcut: 'Ctrl+Shift+N', action: () => setThemeMode('nightShift')},
    {label: 'Show Patch Notes', shortcut: 'Ctrl+Alt+P', action: () => setPatchNotesOpen(true)},
    {label: 'Focus Inventory Search', shortcut: 'Ctrl+L', action: () => document.querySelector('[data-inventory-search]')?.focus()},
    {label: 'Enable Retro Sounds', shortcut: 'Konami Code', action: () => setRetroEnabled(true)}
  ]), [])

  const filteredCommands = commands.filter((command) => {
    const query = paletteQuery.trim().toLowerCase()
    if (!query) return true
    return `${command.label} ${command.shortcut}`.toLowerCase().includes(query)
  })

  function closePalette(){
    setPaletteOpen(false)
    setPaletteQuery('')
  }

  function runCommand(command){
    command.action()
    closePalette()
    if (retroEnabled) {
      playTone(932, 0.04, 0.02)
    }
  }

  const providerValue = {
    isDark,
    isNightShift,
    themeMode,
    toggleTheme: () => setThemeMode((current) => current === 'light' ? 'dark' : 'light'),
    enableNightShift: () => setThemeMode('nightShift'),
    openPatchNotes: () => setPatchNotesOpen(true),
    openPalette: () => setPaletteOpen(true),
    retroEnabled,
    playUiSound: playTone,
    setActiveTab,
    focusInventorySearch: () => document.querySelector('[data-inventory-search]')?.focus()
  }

  const tabs = [
    { id: 'add', label: 'Add Stock', help: 'Scan a barcode or enter a SKU to add inventory.' },
    { id: 'new', label: 'New Product', help: 'Create a custom product if it\'s not in the catalog.' },
    { id: 'checkout', label: 'Checkout', help: 'Remove items from stock for a project.' },
    { id: 'orders', label: 'Purchase Orders', help: 'Create and manage purchase orders, receive inventory.' },
    { id: 'inventory', label: 'Inventory', help: 'View and search all stock levels.' },
    { id: 'changelog', label: 'Change Log', help: 'View all inventory changes and transactions.' },
    { id: 'settings', label: 'Settings', help: 'Manage preferences and data.' }
  ]

  return (
    <ThemeContext.Provider value={providerValue}>
    <div className={`min-h-screen ${themeShell} p-8 ${isNightShift ? 'font-mono' : ''}`}>
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex justify-between items-center mb-8 gap-4 flex-wrap">
          <h1 className={`text-4xl font-bold ${isDark ? 'text-white' : 'text-slate-900'}`}>Inventory Manager</h1>
          <Button size="sm" variant="flat" className={isNightShift ? 'bg-green-950 text-green-200' : ''} onClick={() => setPaletteOpen(true)}>
            Command Palette
          </Button>
        </div>

        {/* Tab Navigation */}
        <div className="flex gap-2 mb-6 flex-wrap items-center">
          {tabs.map(tab => (
            <div key={tab.id} className="relative group">
              <Button
                onClick={() => setActiveTab(tab.id)}
                color={activeTab === tab.id ? 'primary' : 'default'}
                variant={activeTab === tab.id ? 'solid' : 'bordered'}
                className={isDark ? 'text-white' : ''}
                title={tab.help}
              >
                {tab.label}
              </Button>
              <div className={`absolute bottom-full mb-2 left-0 p-2 rounded text-xs whitespace-nowrap hidden group-hover:block ${isDark ? 'bg-slate-700 text-white' : 'bg-slate-300 text-slate-900'} z-50`}>
                {tab.help}
              </div>
            </div>
          ))}
        </div>

        {/* Main Content */}
        <Card className={`shadow-xl ${isNightShift ? 'bg-black/80 text-green-100 border border-green-900' : isDark ? 'bg-slate-800 text-white' : ''}`}>
          <div className="p-0">
            {activeTab === 'add' && <Add />}
            {activeTab === 'new' && <NewProduct />}
            {activeTab === 'checkout' && <Checkout />}
            {activeTab === 'orders' && <Orders />}
            {activeTab === 'inventory' && <Inventory />}
            {activeTab === 'changelog' && <ChangeLog />}
            {activeTab === 'settings' && <Settings />}
          </div>
        </Card>
      </div>

      {patchNotesOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[80] p-4" onClick={() => setPatchNotesOpen(false)}>
          <Card className={`w-full max-w-2xl ${isNightShift ? 'bg-black text-green-200 border border-green-900' : isDark ? 'bg-slate-800 text-white' : ''}`} onClick={(event) => event.stopPropagation()}>
            <div className="p-6 space-y-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-2xl font-bold">Version v2.7.0</h2>
                  <p className={isNightShift ? 'text-green-300' : 'text-slate-500'}>Fake patch notes, because secrets need release notes too.</p>
                </div>
                <Button isIconOnly variant="light" className={isNightShift ? 'text-green-200' : ''} onClick={() => setPatchNotesOpen(false)}>x</Button>
              </div>
              <ul className="list-disc pl-5 space-y-2">
                {fakePatchNotes.map((note) => <li key={note}>{note}</li>)}
              </ul>
              <div className="flex gap-3 flex-wrap">
                <Button color="success" onClick={() => setThemeMode('nightShift')}>Enter Night Shift</Button>
                <Button variant="bordered" onClick={() => setPatchNotesOpen(false)}>Close</Button>
              </div>
            </div>
          </Card>
        </div>
      )}

      {paletteOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-start justify-center z-[90] p-4 pt-24" onClick={closePalette}>
          <Card className={`w-full max-w-2xl ${isNightShift ? 'bg-black text-green-200 border border-green-900' : 'bg-slate-900 text-white'}`} onClick={(event) => event.stopPropagation()}>
            <div className="p-4 space-y-4">
              <PlainInput
                label="Command Palette"
                placeholder="Type a shortcut or command"
                value={paletteQuery}
                onValueChange={setPaletteQuery}
                autoFocus
                isDarkOverride={isNightShift || true}
                className="w-full"
                inputMode="text"
              />
              <div className="grid gap-2 max-h-96 overflow-y-auto">
                {filteredCommands.map((command) => (
                  <Button
                    key={command.label}
                    onClick={() => runCommand(command)}
                    variant="flat"
                    className={`justify-between ${isNightShift ? 'bg-green-950 text-green-100' : 'bg-slate-800 text-white'}`}
                  >
                    <span>{command.label}</span>
                    <span className={isNightShift ? 'text-green-400' : 'text-slate-400'}>{command.shortcut}</span>
                  </Button>
                ))}
                {filteredCommands.length === 0 && (
                  <div className={isNightShift ? 'text-green-400' : 'text-slate-400'}>No commands match that query.</div>
                )}
              </div>
            </div>
          </Card>
        </div>
      )}
    </div>
    </ThemeContext.Provider>
  )
}
