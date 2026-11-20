import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Som ambiente subaquático gerado proceduralmente via Web Audio API —
 * nenhum arquivo de áudio externo é necessário. O ruído rosa filtrado
 * simula o movimento da água e um par de osciladores lentos cria o "drone" do oceano.
 */
export function useAmbientAudio() {
  const [enabled, setEnabled] = useState(false)
  const ctxRef = useRef<AudioContext | null>(null)
  const nodesRef = useRef<{ gain: GainNode; sources: AudioScheduledSourceNode[] } | null>(null)

  const stop = useCallback(() => {
    const nodes = nodesRef.current
    if (!nodes) return
    const now = ctxRef.current?.currentTime ?? 0
    nodes.gain.gain.cancelScheduledValues(now)
    nodes.gain.gain.setTargetAtTime(0, now, 0.15)
    const sources = nodes.sources
    window.setTimeout(() => sources.forEach((source) => source.stop()), 500)
    nodesRef.current = null
  }, [])

  const start = useCallback(() => {
    const AudioCtx = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioCtx) return
    const ctx = ctxRef.current ?? new AudioCtx()
    ctxRef.current = ctx
    void ctx.resume()

    const master = ctx.createGain()
    master.gain.value = 0
    master.connect(ctx.destination)

    // Ruído rosa aproximado: ruído branco em um filtro lowpass inclinado.
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 4, ctx.sampleRate)
    const data = buffer.getChannelData(0)
    let last = 0
    for (let i = 0; i < data.length; i++) {
      const white = Math.random() * 2 - 1
      last = (last + 0.02 * white) / 1.02
      data[i] = last * 3.5
    }
    const noise = ctx.createBufferSource()
    noise.buffer = buffer
    noise.loop = true

    const waterFilter = ctx.createBiquadFilter()
    waterFilter.type = 'lowpass'
    waterFilter.frequency.value = 420
    waterFilter.Q.value = 0.4

    const noiseGain = ctx.createGain()
    noiseGain.gain.value = 0.35
    noise.connect(waterFilter).connect(noiseGain).connect(master)

    // Drone grave e suave.
    const droneA = ctx.createOscillator()
    droneA.type = 'sine'
    droneA.frequency.value = 58
    const droneB = ctx.createOscillator()
    droneB.type = 'sine'
    droneB.frequency.value = 87
    const droneGain = ctx.createGain()
    droneGain.gain.value = 0.07
    droneA.connect(droneGain)
    droneB.connect(droneGain)
    droneGain.connect(master)

    // LFO modulando o filtro: sensação de correnteza.
    const lfo = ctx.createOscillator()
    lfo.frequency.value = 0.08
    const lfoGain = ctx.createGain()
    lfoGain.gain.value = 160
    lfo.connect(lfoGain).connect(waterFilter.frequency)

    noise.start()
    droneA.start()
    droneB.start()
    lfo.start()
    master.gain.setTargetAtTime(0.55, ctx.currentTime, 0.8)

    nodesRef.current = { gain: master, sources: [noise, droneA, droneB, lfo] }
  }, [])

  const toggle = useCallback(() => {
    setEnabled((current) => {
      if (current) stop()
      else start()
      return !current
    })
  }, [start, stop])

  useEffect(() => {
    return () => {
      stop()
      const ctx = ctxRef.current
      if (ctx) void ctx.close()
      ctxRef.current = null
    }
  }, [stop])

  return { enabled, toggle }
}
