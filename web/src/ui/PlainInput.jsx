import React, {useContext} from 'react'
import {ThemeContext} from '../App'

export default function PlainInput({
  label, placeholder, value, onValueChange, type = 'text',
  isClearable, onClear, min, autoFocus, isDisabled, className, startContent, isDarkOverride, inputMode, onKeyDown, ...rest
}){
  const theme = useContext(ThemeContext)
  const isDark = isDarkOverride !== undefined ? isDarkOverride : theme?.isNightShift || theme?.isDark
  const isNightShift = isDarkOverride !== undefined ? false : theme?.isNightShift
  
  return (
    <div className={`flex flex-col ${className || ''}`}>
      {label && <label className={`text-sm mb-1 ${isNightShift ? 'text-green-300' : isDark ? 'text-slate-300' : 'text-slate-600'}`}>{label}</label>}
      <div className="flex items-center">
        {startContent && <div className="mr-2">{startContent}</div>}
        <input
          type={type}
          placeholder={placeholder}
          value={value}
          onChange={e => onValueChange && onValueChange(e.target.value)}
          onKeyDown={onKeyDown}
          autoFocus={autoFocus}
          disabled={isDisabled}
          min={min}
          inputMode={inputMode}
          {...rest}
          className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 ${isNightShift ? 'bg-black text-green-200 border-green-800 placeholder-green-600 focus:ring-green-500' : isDark ? 'bg-slate-700 text-white border-slate-600 placeholder-slate-400 focus:ring-blue-300' : 'bg-white text-slate-900 border-slate-200 placeholder-slate-400 focus:ring-blue-300'} ${isDisabled ? 'opacity-50 cursor-not-allowed' : ''} ${rest.className || ''}`}
        />
        {isClearable && value && (
          <button type="button" onClick={() => { onClear && onClear(); }} className={`ml-2 px-2 py-1 rounded ${isNightShift ? 'bg-green-900 text-green-200' : isDark ? 'bg-slate-600 text-white' : 'bg-slate-100 text-slate-900'}`}>x</button>
        )}
      </div>
    </div>
  )
}
