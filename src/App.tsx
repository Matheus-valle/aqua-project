import { useCallback, useEffect, useRef, useState } from 'react'
import { AquariumCanvas } from './components/AquariumCanvas'
import { HudOverlay } from './components/HudOverlay'
import { useAmbientAudio } from './hooks/useAmbientAudio'
import type { FeedRequest, SceneRuntime } from './scene/types'

export default function App() {
  const sceneRef = useRef<SceneRuntime>({ fish: [], food: [] })
  const [feedRequests, setFeedRequests] = useState<FeedRequest[]>([])
  const [focusId, setFocusId] = useState<string | null>(null)
  const [focusTick, setFocusTick] = useState(0)
  const [cinema, setCinema] = useState(false)
  const { enabled: audioEnabled, toggle: toggleAudio } = useAmbientAudio()

  const handleFeed = useCallback((point: [number, number, number]) => {
    setFeedRequests((requests) => [
      ...requests.slice(-23),
      { id: performance.now(), position: point },
    ])
  }, [])

  const follow = useCallback((id: string) => {
    setFocusId(id)
    setFocusTick((tick) => tick + 1)
  }, [])

  const focusRandomFish = useCallback(() => {
    const fish = sceneRef.current.fish
    if (fish.length === 0) return
    const target = fish[Math.floor(Math.random() * fish.length)]
    follow(target.id)
  }, [follow])

  const exitFocus = useCallback(() => setFocusId(null), [])

  // Força o R3F a medir o contêiner mesmo em navegadores que não disparam
  // o ResizeObserver inicial (ex.: abas em segundo plano / WebView encapsulado).
  useEffect(() => {
    const notify = () => window.dispatchEvent(new Event('resize'))
    const raf = requestAnimationFrame(notify)
    const timer = window.setTimeout(notify, 150)
    return () => {
      cancelAnimationFrame(raf)
      window.clearTimeout(timer)
    }
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement) return
      switch (event.key.toLowerCase()) {
        case 'm':
          toggleAudio()
          break
        case 'c':
          setCinema((value) => !value)
          break
        case 'f':
          focusRandomFish()
          break
        case 'escape':
          setCinema(false)
          setFocusId(null)
          break
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [toggleAudio, focusRandomFish])

  return (
    <main className="experience">
      <AquariumCanvas
        sceneRef={sceneRef}
        feedRequests={feedRequests}
        onFeed={handleFeed}
        onSelectFish={follow}
        focusId={focusId}
        focusTick={focusTick}
      />
      <HudOverlay
        audioEnabled={audioEnabled}
        onToggleAudio={toggleAudio}
        cinema={cinema}
        onToggleCinema={() => setCinema((value) => !value)}
        onFocusFish={focusRandomFish}
        focusId={focusId}
        onExitFocus={exitFocus}
      />
    </main>
  )
}
