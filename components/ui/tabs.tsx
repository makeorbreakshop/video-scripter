"use client"

import * as React from "react"
import { cn } from "@/lib/utils"

interface TabsContextValue {
  selectedValue: string
  onValueChange: (value: string) => void
}

const TabsContext = React.createContext<TabsContextValue | undefined>(undefined)

interface TabsProps extends React.HTMLAttributes<HTMLDivElement> {
  defaultValue?: string
  value?: string
  onValueChange?: (value: string) => void
}

const Tabs = React.forwardRef<HTMLDivElement, TabsProps>(
  ({ className, defaultValue, value, onValueChange, children, ...props }, ref) => {
    const [selectedValue, setSelectedValue] = React.useState(value || defaultValue || "")

    React.useEffect(() => {
      if (value !== undefined) {
        setSelectedValue(value)
      }
    }, [value])

    const handleValueChange = React.useCallback(
      (newValue: string) => {
        setSelectedValue(newValue)
        onValueChange?.(newValue)
      },
      [onValueChange],
    )

    return (
      <TabsContext.Provider value={{ selectedValue, onValueChange: handleValueChange }}>
        <div ref={ref} className={cn("", className)} {...props}>
          {children}
        </div>
      </TabsContext.Provider>
    )
  },
)
Tabs.displayName = "Tabs"

interface TabsListProps extends React.HTMLAttributes<HTMLDivElement> {}

const TabsList = React.forwardRef<HTMLDivElement, TabsListProps>(({ className, ...props }, ref) => {
  return <div ref={ref} className={cn("flex border-b border-border", className)} {...props} />
})
TabsList.displayName = "TabsList"

interface TabsTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  value: string
}

const TabsTrigger = React.forwardRef<HTMLButtonElement, TabsTriggerProps>(({ className, value, ...props }, ref) => {
  const context = React.useContext(TabsContext)

  if (!context) {
    throw new Error("TabsTrigger must be used within a Tabs component")
  }

  const { selectedValue, onValueChange } = context

  return (
    <button
      ref={ref}
      className={cn(
        "px-4 py-2 text-sm font-medium",
        selectedValue === value
          ? "border-b-2 border-primary text-foreground"
          : "text-muted-foreground hover:text-foreground",
        className,
      )}
      onClick={() => onValueChange(value)}
      {...props}
    />
  )
})
TabsTrigger.displayName = "TabsTrigger"

interface TabsContentProps extends React.HTMLAttributes<HTMLDivElement> {
  value: string
}

const TabsContent = React.forwardRef<HTMLDivElement, TabsContentProps>(({ className, value, ...props }, ref) => {
  const context = React.useContext(TabsContext)

  if (!context) {
    throw new Error("TabsContent must be used within a Tabs component")
  }

  const { selectedValue } = context

  if (selectedValue !== value) {
    return null
  }

  return <div ref={ref} className={cn("mt-4", className)} {...props} />
})
TabsContent.displayName = "TabsContent"

export { Tabs, TabsList, TabsTrigger, TabsContent }

