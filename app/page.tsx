'use client'

import React, { useState, useEffect, useRef, FC, ReactNode, InputHTMLAttributes, ButtonHTMLAttributes } from 'react'
import { Play, Activity, Target, ShieldCheck, Cpu, Search, Bot } from 'lucide-react'
import { gsap } from 'gsap'

interface AgentReport {
  agent: string;
  findings: string;
}
interface Results {
  echoScore: number;
  argumentMap: {
    mainPoints: string[];
    counterpoints: string[];
  };
  agentReports: AgentReport[];
}
interface AgentState {
  name: 'Advocate' | 'Skeptic' | 'Synthesizer';
  title: string;
  color: string;
  icon: ReactNode;
  report: string;
}

interface VortexInputProps extends InputHTMLAttributes<HTMLInputElement> {
  icon: ReactNode;
}
const VortexInput: FC<VortexInputProps> = ({ icon, ...props }) => (
  <div className="input-container">
    {icon}
    <input {...props} />
  </div>
);

async function fetchWithRetry(
  input: RequestInfo,
  init: RequestInit,
  retries = 3,
  backoff = 500
): Promise<Response> {
  try {
    const res = await fetch(input, init)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res
  } catch (err) {
    if (retries > 0) {
      await new Promise(r => setTimeout(r, backoff))
      return fetchWithRetry(input, init, retries - 1, backoff * 2)
    }
    throw err
  }
}

interface MagneticButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
}
const MagneticButton: FC<MagneticButtonProps> = ({ children, onClick, disabled, ...props }) => {
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    const button = buttonRef.current;
    if (!button || disabled) return;
    const onMouseMove = (e: MouseEvent) => {
      const { left, top, width, height } = button.getBoundingClientRect();
      const x = e.clientX - left - width / 2;
      const y = e.clientY - top - height / 2;
      gsap.to(button, { x: x * 0.4, y: y * 0.4, duration: 0.7, ease: 'power4.out' });
    };
    const onMouseLeave = () => {
      gsap.to(button, { x: 0, y: 0, duration: 1, ease: 'elastic.out(1, 0.3)' });
    };
    button.addEventListener('mousemove', onMouseMove);
    button.addEventListener('mouseleave', onMouseLeave);
    return () => {
      button.removeEventListener('mousemove', onMouseMove);
      button.removeEventListener('mouseleave', onMouseLeave);
    };
  }, [disabled]);
  return (
    <button ref={buttonRef} onClick={onClick} disabled={disabled} className="magnetic-button" {...props}>
      <span className="magnetic-button-text">{children}</span>
    </button>
  );
};

export default function EchocheckInterface() {
  const [videoUrl, setVideoUrl] = useState<string>('');
  const [userPrompt, setUserPrompt] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [analysisStage, setAnalysisStage] = useState<'form' | 'streaming' | 'complete'>('form');
  const [results, setResults] = useState<Results | null>(null);

  const initialAgents: AgentState[] = [
    { name: 'Advocate', title: 'The Advocate', color: 'hsl(145, 63%, 49%)', icon: <Search />, report: '' },
    { name: 'Skeptic', title: 'The Skeptic', color: 'hsl(6, 78%, 57%)', icon: <Activity />, report: '' },
    { name: 'Synthesizer', title: 'The Synthesizer', color: 'hsl(204, 86%, 53%)', icon: <Bot />, report: '' },
  ];
  const [agents, setAgents] = useState<AgentState[]>(initialAgents);
  
  const vortexCardRef = useRef<HTMLDivElement | null>(null);
  const formRef = useRef<HTMLDivElement | null>(null);
  const analysisViewRef = useRef<HTMLDivElement | null>(null);
  const resultsViewRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    gsap.fromTo(vortexCardRef.current, 
      { opacity: 0, y: 50, scale: 0.95 }, 
      { opacity: 1, y: 0, scale: 1, duration: 1.2, ease: 'power4.out', delay: 0.2 }
    );
  }, []);
  
  useEffect(() => {
    const tl = gsap.timeline();
    if (analysisStage === 'streaming') {
      tl.to(formRef.current, { opacity: 0, y: -30, duration: 0.5, ease: 'power2.in' })
        .set(formRef.current, { display: 'none' })
        .set(analysisViewRef.current, { display: 'flex' })
        .fromTo(analysisViewRef.current, 
          { opacity: 0, scale: 0.8 }, 
          { opacity: 1, scale: 1, duration: 0.7, ease: 'power4.out' }
        )
        .fromTo('.agent-pod', 
          { opacity: 0, y: 30 }, 
          { opacity: 1, y: 0, duration: 0.5, stagger: 0.2, ease: 'power3.out' }
        );
    } else if (analysisStage === 'complete' && results) {
      tl.to(analysisViewRef.current, { opacity: 0, scale: 1.1, duration: 0.5, ease: 'power2.in' })
        .set(analysisViewRef.current, { display: 'none' })
        .set(resultsViewRef.current, { display: 'block' })
        .fromTo(resultsViewRef.current, { opacity: 0 }, { opacity: 1, duration: 0.5 })
        .fromTo('.result-reveal', 
          { opacity: 0, y: 20 }, 
          { opacity: 1, y: 0, duration: 0.6, ease: 'power3.out', stagger: 0.15 }
        );
    }
  }, [analysisStage, results]);

  const analyzeContent = async () => {
    setError(null);
    setAgents(initialAgents);
    setAnalysisStage('streaming');

    try {
      const response = await fetchWithRetry(
        '/api/analyze',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ videoUrl, userPrompt }),
        },
        3,
        500
      )

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Analysis failed.');
      }

      if (!response.body) {
        throw new Error("Response body is missing.");
      }
      
      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      let done = false;
      while (!done) {
        const { value, done: readerDone } = await reader.read();
        done = readerDone;
        const chunk = decoder.decode(value, { stream: true });
        
        const events = chunk.split('data: ').filter(s => s.trim());
        for (const event of events) {
          try {
            const data = JSON.parse(event);
            if (data.type === 'agent_chunk') {
              const { agentName, chunk } = data.payload;
              setAgents(prevAgents => prevAgents.map(agent => 
                agent.name === agentName 
                  ? { ...agent, report: agent.report + chunk }
                  : agent
              ));
            } else if (data.type === 'final_result') {
              setResults(data.payload);
              setAnalysisStage('complete');
            }
          } catch (e: unknown) {
            console.warn('Failed to parse stream chunk:', event, e);
          }
        }
      }

    } catch (e: unknown) {
      console.error("Analysis Error:", e);
      setError(e instanceof Error ? e.message : 'Unknown error');
      setAnalysisStage('form');
      const tl = gsap.timeline();
      tl.to(analysisViewRef.current, { opacity: 0, scale: 0.8, duration: 0.5, ease: 'power2.in' })
          .set(analysisViewRef.current, { display: 'none' })
          .set(formRef.current, { display: 'block', y: -30 })
          .to(formRef.current, { opacity: 1, y: 0, duration: 0.5, ease: 'power2.out' });
    }
  };

  return (
    <div className="echocheck-container invert">
      <div className="aurora-background">
        <div className="aurora-layer aurora-layer-1"></div>
        <div className="aurora-layer aurora-layer-2"></div>
        <div className="aurora-layer aurora-layer-3"></div>
      </div>
      
      <svg width="0" height="0" style={{ position: 'absolute' }}>
        <defs>
          <linearGradient id="gauge-gradient" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#2ecc71" />
            <stop offset="50%" stopColor="#f1c40f" />
            <stop offset="100%" stopColor="#e74c3c" />
          </linearGradient>
        </defs>
      </svg>
      
      <div ref={vortexCardRef} className="vortex-card">
        <div className="vortex-header">
          <h1 className="vortex-title">Echocheck</h1>
          <p className="vortex-subtitle">Peer into the abyss of information. Emerge with clarity.</p>
        </div>

        <div className="vortex-content">
          <div ref={formRef} style={{ display: analysisStage === 'form' ? 'block' : 'none' }}>
            <div className="space-y-6">
              <VortexInput
                icon={<Play />}
                placeholder="Enter YouTube video URL..."
                type="text"
                value={videoUrl}
                onChange={(e) => setVideoUrl(e.target.value)}
              />
              <VortexInput
                icon={<Target />}
                placeholder="What is the core perspective being checked?"
                type="text"
                value={userPrompt}
                onChange={(e) => setUserPrompt(e.target.value)}
              />
            </div>
            {error && <p className="error-message">{error}</p>}
            <MagneticButton onClick={analyzeContent} disabled={!videoUrl || !userPrompt || analysisStage !== 'form'} className="mt-8 w-full">
              {analysisStage !== 'form' ? 'Analyzing...' : 'Initiate Analysis'}
            </MagneticButton>
          </div>

          <div ref={analysisViewRef} className="analysis-view" style={{ display: analysisStage === 'streaming' ? 'flex' : 'none' }}>
            <div className="analysis-header">
              <Cpu className="synapse-icon" />
              <p className="synapse-text">Cognitive agents deployed. Analyzing transcript...</p>
            </div>
            <div className="agents-grid">
              {agents.map(agent => (
                <div key={agent.name} className="agent-pod" style={{ '--agent-color': agent.color } as React.CSSProperties}>
                  <div className="agent-pod-header">
                    {agent.icon}
                    <span>{agent.title}</span>
                  </div>
                  <div className="agent-pod-body">
                    <p>{agent.report}<span className="blinking-cursor"></span></p>
                  </div>
                </div>
              ))}
            </div>
          </div>
          
          <div ref={resultsViewRef} style={{ display: analysisStage === 'complete' ? 'block' : 'none' }}>
            {results && (
              <>
                <div className="resonance-core-container result-reveal">
                  <h3 className="result-title">Resonance Score</h3>
                  <div className="resonance-core" style={{ '--score': results.echoScore, '--hue': 360 - (results.echoScore * 2.4) } as React.CSSProperties}>
                    <span className="resonance-score-value">{results.echoScore}</span>
                    <svg className="resonance-gauge" viewBox="0 0 120 120">
                      <circle cx="60" cy="60" r="54" className="gauge-track" />
                      <circle cx="60" cy="60" r="54" className="gauge-fill" pathLength="100" strokeDasharray="100" strokeDashoffset={100 - results.echoScore} />
                    </svg>
                  </div>
                  <p className="resonance-summary">{results.echoScore > 70 ? 'High probability of forming an echo chamber.' : 'Contains a moderate diversity of perspectives.'}</p>
                </div>

                <div className="argument-graph result-reveal">
                  <h3 className="result-title">Argument & Counter-Argument Map</h3>
                  <div className="graph-content">
                    <div className="graph-column">
                      <h4>Core Arguments Presented</h4>
                      <ul>{results.argumentMap.mainPoints.map((p, i) => <li key={i}>{p}</li>)}</ul>
                    </div>
                    <div className="graph-divider"></div>
                    <div className="graph-column">
                      <h4>Missing Counterpoints</h4>
                      <ul>{results.argumentMap.counterpoints.map((p, i) => <li key={i}>{p}</li>)}</ul>
                    </div>
                  </div>
                </div>

                <div className="agent-dossiers-container result-reveal">
                  <h3 className="result-title">Agent Dossiers</h3>
                  <div className="agent-dossiers">
                    {results.agentReports.map((report, i) => (
                      <div key={i} className="dossier-card result-reveal">
                        <div className="dossier-header">
                          <ShieldCheck className="dossier-icon"/>
                          <h5 className="dossier-title">{report.agent}</h5>
                        </div>
                        <p className="dossier-findings">{report.findings}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}