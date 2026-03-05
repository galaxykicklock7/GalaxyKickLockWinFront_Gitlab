import React, { useEffect, useRef } from 'react';
import './LogsPanel.css';

const LogWindow = ({ title, logs }) => {
  const logRef = useRef(null);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [logs]);

  return (
    <div className="log-window">
      <div className="log-header">{title}</div>
      <div className="log-content" ref={logRef}>
        {logs && logs.length > 0 ? (
          logs.map((log, index) => (
            <div key={index} className="log-entry">
              <span className="log-timestamp">
                {new Date(log.timestamp).toLocaleTimeString()}
              </span>
              <span className="log-message">{log.message}</span>
            </div>
          ))
        ) : (
          <div className="log-empty">No logs yet...</div>
        )}
      </div>
    </div>
  );
};

const LogsPanel = ({ logs }) => {
  
  return (
    <fieldset className="logs-panel">
      <legend>Information Logs</legend>

      <div className="logs-grid">
        <LogWindow title="Connection 1" logs={logs.log1} />
        <LogWindow title="Connection 2" logs={logs.log2} />
        <LogWindow title="Connection 3" logs={logs.log3} />
        <LogWindow title="Connection 4" logs={logs.log4} />
        <LogWindow title="Connection 5" logs={logs.log5} />
      </div>
    </fieldset>
  );
};

export default LogsPanel;
