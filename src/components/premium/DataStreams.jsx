import React, { useEffect, useRef } from 'react';
import './PremiumLayout.css';

const StreamTerminal = ({ id, logs }) => {
    const contentRef = useRef(null);

    useEffect(() => {
        if (contentRef.current) {
            contentRef.current.scrollTop = contentRef.current.scrollHeight;
        }
    }, [logs]);

    return (
        <div className="stream-terminal">
            <div className="stream-header">
                <span>CONN {id}</span>
                <span style={{ color: logs && logs.length > 0 ? '#0aff0a' : '#fff' }}>
                    {logs && logs.length > 0 ? 'ACT' : 'IDLE'}
                </span>
            </div>
            <div className="stream-content" ref={contentRef}>
                {logs && logs.length > 0 ? (
                    logs.map((log, i) => (
                        <div key={i} className="log-line">
                            <span className="log-ts">[{new Date(log.timestamp).toLocaleTimeString().split(' ')[0]}]</span>
                            <span>{log.message}</span>
                        </div>
                    ))
                ) : (
                    <div style={{ color: '#fff' }}>NO SIGNAL...</div>
                )}
            </div>
        </div>
    );
};

const DataStreams = ({ logs }) => {
    return (
        <div className="data-streams">
            <StreamTerminal id="1" logs={logs.log1} />
            <StreamTerminal id="2" logs={logs.log2} />
            <StreamTerminal id="3" logs={logs.log3} />
            <StreamTerminal id="4" logs={logs.log4} />
            <StreamTerminal id="5" logs={logs.log5} />
        </div>
    );
};

export default DataStreams;
