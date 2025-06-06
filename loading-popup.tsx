"use client"

import { useState, useEffect } from "react"
import { CheckCircle2, Loader2, AlertCircle } from "lucide-react"

type Provider = {
  name: string
  status: "pending" | "loading" | "completed" | "error"
}

export default function LoadingPopup() {
  const [isVisible, setIsVisible] = useState(true)
  const [providers, setProviders] = useState<Provider[]>([
    { name: "Vidsrc", status: "pending" },
    { name: "AutoEmbed", status: "pending" },
    { name: "UEmbed", status: "pending" },
    { name: "P-Stream", status: "pending" },
  ])

  // Simulate scraping process
  useEffect(() => {
    const simulateScraping = () => {
      let currentProviderIndex = 0

      const interval = setInterval(() => {
        if (currentProviderIndex >= providers.length) {
          clearInterval(interval)
          return
        }

        setProviders((prev) => {
          const updated = [...prev]

          // Start current provider
          if (updated[currentProviderIndex].status === "pending") {
            updated[currentProviderIndex].status = "loading"
            return updated
          }

          // Complete or error
          if (updated[currentProviderIndex].status === "loading") {
            // Randomly decide if provider scraping succeeds or fails (90% success rate)
            updated[currentProviderIndex].status = Math.random() > 0.1 ? "completed" : "error"
            currentProviderIndex++
          }

          return updated
        })
      }, 1000)

      return () => clearInterval(interval)
    }

    simulateScraping()
  }, [])

  const getContainerRounding = (index: number, total: number) => {
    if (index === 0) {
      // First item - rounded top corners
      return "rounded-t-xl rounded-b-sm"
    } else if (index === total - 1) {
      // Last item - rounded bottom corners
      return "rounded-b-xl rounded-t-sm"
    } else {
      // Middle items - minimal rounding
      return "rounded-sm"
    }
  }

  if (!isVisible) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm">
      <div className="relative w-full max-w-md h-[90vh] overflow-hidden rounded-2xl bg-gradient-to-br from-black to-gray-900 shadow-2xl transition-all duration-500 hover:shadow-[#0099ff]/25 hover:shadow-3xl flex flex-col">
        {/* Premium background effects */}
        <div className="absolute inset-0 bg-gradient-to-br from-[#0099ff]/5 via-transparent to-purple-500/5"></div>
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(0,153,255,0.1),transparent_50%)]"></div>

        {/* Subtle border glow */}
        <div className="absolute inset-0 rounded-2xl bg-gradient-to-r from-[#0099ff]/20 via-transparent to-[#0099ff]/20 p-px">
          <div className="h-full w-full rounded-2xl bg-gradient-to-br from-black to-gray-900"></div>
        </div>

        {/* Header - Fixed */}
        <div className="relative p-8 pb-6 flex-shrink-0">
          <div className="flex items-center justify-between mb-6">
            <h2 className="bg-gradient-to-r from-[#0099ff] to-cyan-400 bg-clip-text text-2xl font-bold text-transparent tracking-wide">
              Scraping Providers
            </h2>
            <div className="rounded-full bg-[#0099ff]/10 px-3 py-1 text-sm text-[#0099ff] font-medium backdrop-blur-sm">
              {providers.filter((p) => p.status === "completed").length} / {providers.length}
            </div>
          </div>

          {/* Separator line */}
          <div className="h-px bg-gradient-to-r from-transparent via-white/30 to-transparent shadow-sm"></div>
        </div>

        {/* Providers list - Scrollable */}
        <div className="relative flex-1 px-8 pb-8 overflow-y-auto">
          <div className="space-y-px">
            {providers.map((provider, index) => (
              <div
                key={provider.name}
                className={`relative overflow-hidden ${getContainerRounding(index, providers.length)} bg-gradient-to-r from-gray-900/50 to-gray-800/30 p-4 backdrop-blur-sm`}
                style={{
                  animationDelay: `${index * 100}ms`,
                  animation: "fadeInUp 0.6s ease-out forwards",
                }}
              >
                <div className="relative flex items-center justify-between">
                  <span className="text-lg font-semibold text-[#0099ff] tracking-wide">{provider.name}</span>
                  <StatusIndicator status={provider.status} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <style jsx>{`
        @keyframes fadeInUp {
          from {
            opacity: 0;
            transform: translateY(20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
    </div>
  )
}

function StatusIndicator({ status }: { status: Provider["status"] }) {
  switch (status) {
    case "pending":
      return (
        <div className="flex items-center gap-2 rounded-full bg-gray-700/50 px-3 py-1">
          <div className="h-2 w-2 rounded-full bg-[#0099ff]/60"></div>
          <span className="text-sm text-[#0099ff]/80 font-medium">Pending</span>
        </div>
      )
    case "loading":
      return (
        <div className="flex items-center gap-2 rounded-full bg-[#0099ff]/10 px-3 py-1">
          <Loader2 className="h-4 w-4 animate-spin text-[#0099ff]" />
          <span className="text-sm text-[#0099ff] font-medium">Processing</span>
        </div>
      )
    case "completed":
      return (
        <div className="flex items-center gap-2 rounded-full bg-green-500/10 px-3 py-1">
          <CheckCircle2 className="h-4 w-4 text-green-500" />
          <span className="text-sm text-green-500 font-medium">Complete</span>
        </div>
      )
    case "error":
      return (
        <div className="flex items-center gap-2 rounded-full bg-red-500/10 px-3 py-1">
          <AlertCircle className="h-4 w-4 text-red-500" />
          <span className="text-sm text-red-500 font-medium">Failed</span>
        </div>
      )
  }
}
