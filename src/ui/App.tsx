import { useState, useEffect } from 'react';
import './App.css';

const { ipcRenderer } = (window as any).require('electron');

interface RequestState {
  id?: number;
  name?: string;
  method: string;
  url: string;
  headers: { key: string; value: string }[];
  body: string;
  scanType: string;
  collectionId?: number;
  auth?: {
    type: 'none' | 'bearer' | 'basic';
    token?: string;
    username?: string;
    password?: string;
  };
}

interface Collection {
  id: number;
  name: string;
  requests: RequestState[];
}

interface ResponseState {
  status: string;
  time: string;
  size: string;
  headers: { [key: string]: string };
  requestHeaders?: { [key: string]: string };
  body: string;
  error?: string;
  fullOutput: string;
}

function App() {
  const [request, setRequest] = useState<RequestState>({
    method: 'GET',
    url: 'https://api.github.com',
    headers: [{ key: '', value: '' }],
    body: '',
    scanType: 'all',
    auth: { type: 'none' },
  });

  const [response, setResponse] = useState<ResponseState | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('headers');
  const [responseTab, setResponseTab] = useState('body');
  const [history, setHistory] = useState<RequestState[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [collapsedCollections, setCollapsedCollections] = useState<Set<number>>(new Set());
  const [isLoaded, setIsLoaded] = useState(false);

  // Load data
  useEffect(() => {
    const savedHistory = localStorage.getItem('http_cli_history');
    if (savedHistory) setHistory(JSON.parse(savedHistory));

    const savedCollections = localStorage.getItem('http_cli_collections_v3');
    if (savedCollections) setCollections(JSON.parse(savedCollections));

    setIsLoaded(true);

    // Menu listeners
    const handleNew = () => setRequest({ method: 'GET', url: '', headers: [{ key: '', value: '' }], body: '', scanType: 'all', auth: { type: 'none' } });
    ipcRenderer.on('menu-new-request', handleNew);
    ipcRenderer.on('menu-import', handleImport);
    ipcRenderer.on('menu-export', handleExport);

    return () => {
      ipcRenderer.removeListener('menu-new-request', handleNew);
      ipcRenderer.removeListener('menu-import', handleImport);
      ipcRenderer.removeListener('menu-export', handleExport);
    };
  }, []);

  // Sync to localStorage
  useEffect(() => {
    if (isLoaded) {
      localStorage.setItem('http_cli_history', JSON.stringify(history.slice(0, 50)));
    }
  }, [history, isLoaded]);

  useEffect(() => {
    if (isLoaded) {
      localStorage.setItem('http_cli_collections_v3', JSON.stringify(collections));
    }
  }, [collections, isLoaded]);

  const parseVerboseOutput = (output: string): Partial<ResponseState> => {
    const lines = output.split('\n');
    let status = 'Done';
    let time = 'N/A';
    let headers: { [key: string]: string } = {};
    let body = '';
    let inHeaders = false;
    let inBody = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith('Status:')) status = line.replace('Status:', '').trim();
      if (line.startsWith('Time:')) time = line.replace('Time:', '').trim();

      if (line.trim() === 'Headers:') {
        inHeaders = true;
        inBody = false;
        continue;
      }
      if (line.trim() === 'Body:') {
        inHeaders = false;
        inBody = true;
        continue;
      }

      if (inHeaders) {
        if (line.includes(':')) {
          const [key, ...vals] = line.trim().split(':');
          headers[key.trim()] = vals.join(':').trim();
        }
      } else if (inBody) {
        body += line + '\n';
      }
    }

    return { status, time, headers, body: body.trim() };
  };

  const handleSend = async (isScan = false) => {
    setLoading(true);
    setResponse(null);

    const args = ['-url', `"${request.url}"`, '-X', request.method, '-v'];

    const effectiveHeaders: { [key: string]: string } = {};
    request.headers.forEach(h => {
      if (h.key && h.value) effectiveHeaders[h.key] = h.value;
    });

    if (request.auth?.type === 'bearer' && request.auth.token) {
      effectiveHeaders['Authorization'] = `Bearer ${request.auth.token}`;
    } else if (request.auth?.type === 'basic' && request.auth.username) {
      const basic = btoa(`${request.auth.username}:${request.auth.password || ''}`);
      effectiveHeaders['Authorization'] = `Basic ${basic}`;
    }

    const headerStr = Object.entries(effectiveHeaders)
      .map(([k, v]) => `${k}:${v}`)
      .join(',');

    if (headerStr) args.push('-H', `"${headerStr}"`);

    if (request.body && request.method !== 'GET') {
      args.push('-d', `'${request.body}'`);
    }

    if (isScan) {
      args.push('-scan', '-scan-type', request.scanType);
    }

    try {
      const result = await ipcRenderer.invoke('execute-http-cli', args);
      if (result.error) {
        setResponse({
          status: 'Error',
          time: '0',
          size: '0',
          headers: {},
          requestHeaders: effectiveHeaders,
          body: result.stderr || result.error,
          error: result.error,
          fullOutput: result.stdout || result.stderr || ''
        });
      } else {
        const parsed = parseVerboseOutput(result.stdout);
        setResponse({
          status: parsed.status || 'Done',
          time: parsed.time || 'N/A',
          size: new TextEncoder().encode(parsed.body || '').length + ' bytes',
          headers: parsed.headers || {},
          requestHeaders: effectiveHeaders,
          body: parsed.body || '',
          fullOutput: result.stdout
        });

        setHistory(prev => [{ ...request, id: Date.now() }, ...prev]);
        if (isScan) setResponseTab('scan');
        else setResponseTab('body');
      }
    } catch (err: any) {
      setResponse({
        status: 'Failed',
        time: '0',
        size: '0',
        headers: {},
        body: err.message,
        error: err.message,
        fullOutput: ''
      });
    } finally {
      setLoading(false);
    }
  };

  const handleCreateCollection = () => {
    const name = prompt('Enter collection name:');
    if (name) {
      setCollections(prev => [...prev, { id: Date.now(), name, requests: [] }]);
    }
  };

  const handleRenameCollection = (id: number) => {
    const coll = collections.find(c => c.id === id);
    if (!coll) return;
    const name = prompt('Enter new collection name:', coll.name);
    if (name) {
      setCollections(prev => prev.map(c => c.id === id ? { ...c, name } : c));
    }
  };

  const handleDeleteCollection = (id: number) => {
    if (confirm('Delete this collection and all its requests?')) {
      setCollections(prev => prev.filter(c => c.id !== id));
    }
  };

  const saveToCollection = (collectionId: number) => {
    const name = prompt('Enter a name for this request:');
    if (name) {
      // Ensure we create a fresh copy of the request to avoid reference issues
      const requestToSave = {
        ...request,
        id: Date.now(),
        collectionId,
        name // Set the name provided by the user
      };

      setCollections(prev => prev.map(c =>
        c.id === collectionId
          ? { ...c, requests: [...c.requests, requestToSave] }
          : c
      ));
    }
  };

  const toggleCollection = (id: number) => {
    setCollapsedCollections(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const getDisplayName = (url: string) => {
    if (!url) return 'Untitled Request';
    try {
      const path = new URL(url).pathname;
      const segments = path.split('/').filter(Boolean);
      return segments.length > 0 ? segments[segments.length - 1] : url;
    } catch {
      // Fallback if URL is invalid or relative
      const segments = url.split('/').filter(Boolean);
      return segments.length > 0 ? segments[segments.length - 1] : url;
    }
  };

  const handleRenameRequest = (collId: number, reqId: number) => {
    const coll = collections.find(c => c.id === collId);
    if (!coll) return;
    const req = coll.requests.find(r => r.id === reqId);
    if (!req) return;
    const name = prompt('Enter new request name:', req.name);
    if (name) {
      setCollections(prev => prev.map(c =>
        c.id === collId
          ? { ...c, requests: c.requests.map(r => r.id === reqId ? { ...r, name } : r) }
          : c
      ));
    }
  };

  const handleDeleteRequest = (collId: number, reqId: number) => {
    if (confirm('Delete this request from collection?')) {
      setCollections(prev => prev.map(c =>
        c.id === collId
          ? { ...c, requests: c.requests.filter(r => r.id !== reqId) }
          : c
      ));
    }
  };

  const handleExport = () => {
    const data = JSON.stringify(collections, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'collections.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const convertPostmanToInternal = (postmanData: any): Collection[] => {
    // Basic check for Postman collection format
    if (postmanData.info && Array.isArray(postmanData.item)) {
      const variables = postmanData.variable || [];
      const resolveVars = (str: string) => {
        if (typeof str !== 'string') return str;
        let resolved = str;
        variables.forEach((v: any) => {
          const regex = new RegExp(`{{${v.key}}}`, 'g');
          resolved = resolved.replace(regex, v.value);
        });
        return resolved;
      };

      const requests: RequestState[] = [];

      const processItems = (items: any[], pathPrefix = '') => {
        items.forEach((item: any) => {
          if (item.request) {
            const req = item.request;
            const headers = Array.isArray(req.header)
              ? req.header.map((h: any) => ({ key: resolveVars(h.key), value: resolveVars(h.value) }))
              : [];

            let url = '';
            if (typeof req.url === 'string') {
              url = resolveVars(req.url);
            } else if (req.url && req.url.raw) {
              url = resolveVars(req.url.raw);
            }

            requests.push({
              id: Date.now() + Math.random(),
              name: pathPrefix + item.name,
              method: req.method || 'GET',
              url: url,
              headers: headers.length > 0 ? headers : [{ key: '', value: '' }],
              body: req.body?.raw ? resolveVars(req.body.raw) : '',
              scanType: 'all'
            });
          } else if (item.item && Array.isArray(item.item)) {
            processItems(item.item, pathPrefix + item.name + ' / ');
          }
        });
      };

      processItems(postmanData.item);

      return [{
        id: Date.now(),
        name: postmanData.info.name || 'Imported Postman Collection',
        requests: requests
      }];
    }
    return postmanData; // Assume ours if not Postman
  };

  const handleImport = async () => {
    console.log('Import button clicked');
    try {
      const content = await ipcRenderer.invoke('open-file');
      if (!content) {
        console.log('Import canceled or returned null');
        return;
      }
      if (typeof content === 'object' && content.error) {
        alert('Import Error: ' + content.error);
        return;
      }

      let data = JSON.parse(content);
      data = convertPostmanToInternal(data);

      if (!Array.isArray(data)) {
        alert('Invalid format: Expected a list of collections or a Postman collection.');
        return;
      }

      setCollections(prev => [...prev, ...data]);
      alert('Collections imported successfully (' + data.length + ' collections)');
    } catch (err: any) {
      console.error('Import error:', err);
      alert('Failed to import collections: ' + err.message);
    }
  };

  const addHeader = () => setRequest(prev => ({ ...prev, headers: [...prev.headers, { key: '', value: '' }] }));
  const updateHeader = (index: number, field: 'key' | 'value', val: string) => {
    const newHeaders = [...request.headers];
    newHeaders[index][field] = val;
    setRequest(prev => ({ ...prev, headers: newHeaders }));
  };

  return (
    <div className="app-container">
      <aside className="sidebar glass">
        <div className="sidebar-header">
          <h2>GHOSTWIRE</h2>
          <div className="sidebar-actions">
            <button className="btn btn-ghost btn-xs" onClick={handleExport} title="Export">📤</button>
            <button className="btn btn-ghost btn-xs" onClick={handleImport} title="Import">📥</button>
            <button className="btn btn-ghost btn-xs" onClick={handleCreateCollection} title="New Collection">➕</button>
          </div>
        </div>
        <div className="sidebar-content">
          <div className="section-title">Collections</div>
          {collections.length === 0 && <div className="empty-state">No collections</div>}
          {collections.map((coll) => (
            <div key={coll.id} className={`collection-group ${collapsedCollections.has(coll.id) ? 'collapsed' : ''}`}>
              <div className="collection-header" onClick={() => toggleCollection(coll.id)}>
                <div className="collection-info">
                  <span className="collapse-icon">{collapsedCollections.has(coll.id) ? '▶' : '▼'}</span>
                  <span className="collection-name">📁 {coll.name}</span>
                </div>
                <div className="collection-actions">
                  <button className="action-btn" onClick={(e) => { e.stopPropagation(); handleRenameCollection(coll.id); }}>✏️</button>
                  <button className="action-btn" onClick={(e) => { e.stopPropagation(); handleDeleteCollection(coll.id); }}>🗑️</button>
                </div>
              </div>
              {!collapsedCollections.has(coll.id) && (
                <div className="collection-items">
                  {coll.requests.map(r => (
                    <div key={r.id} className="history-item collection-item" onClick={() => setRequest(r)}>
                      <div className="req-info">
                        <span className={`method-badge ${r.method.toLowerCase()}`}>{r.method}</span>
                        <div className="req-name-container">
                          <span className="req-title">{r.name || getDisplayName(r.url)}</span>
                          <span className="req-subtitle">{r.url}</span>
                        </div>
                      </div>
                      <div className="item-actions">
                        <button className="action-btn" onClick={(e) => { e.stopPropagation(); handleRenameRequest(coll.id, r.id!); }}>✏️</button>
                        <button className="action-btn" onClick={(e) => { e.stopPropagation(); handleDeleteRequest(coll.id, r.id!); }}>🗑️</button>
                      </div>
                    </div>
                  ))}
                  <button className="btn btn-ghost btn-xs add-to-coll" onClick={() => saveToCollection(coll.id)}>+ Add current</button>
                </div>
              )}
            </div>
          ))}

          <div className="section-title">History</div>
          {history.length === 0 && <div className="empty-state">No history yet</div>}
          {history.map((h) => (
            <div key={h.id} className="history-item" onClick={() => setRequest(h)}>
              <span className={`method-badge ${h.method.toLowerCase()}`}>{h.method}</span>
              <div className="req-name-container">
                <span className="req-title">{h.name || getDisplayName(h.url)}</span>
                <span className="req-subtitle">{h.url}</span>
              </div>
            </div>
          ))}
        </div>
      </aside>

      <main className="main-content">
        <header className="request-header glass">
          <select
            className="method-select"
            value={request.method}
            onChange={(e) => setRequest(prev => ({ ...prev, method: e.target.value }))}
          >
            <option>GET</option>
            <option>POST</option>
            <option>PUT</option>
            <option>DELETE</option>
            <option>PATCH</option>
          </select>
          <input
            type="text"
            className="url-input input"
            value={request.url}
            onChange={(e) => setRequest(prev => ({ ...prev, url: e.target.value }))}
            placeholder="https://api.example.com"
          />
          <button className="btn btn-primary" onClick={() => handleSend(false)} disabled={loading}>
            {loading ? 'Sending...' : 'Send'}
          </button>
          <button className="btn btn-accent" onClick={() => handleSend(true)} disabled={loading}>
            {loading ? 'Scanning...' : 'Security Scan'}
          </button>
        </header>

        <section className="request-editor">
          <div className="tabs">
            <button className={`tab ${activeTab === 'auth' ? 'active' : ''}`} onClick={() => setActiveTab('auth')}>Authorization</button>
            <button className={`tab ${activeTab === 'headers' ? 'active' : ''}`} onClick={() => setActiveTab('headers')}>Headers</button>
            <button className={`tab ${activeTab === 'body' ? 'active' : ''}`} onClick={() => setActiveTab('body')}>Body</button>
            <button className={`tab ${activeTab === 'scan' ? 'active' : ''}`} onClick={() => setActiveTab('scan')}>Scan Settings</button>
          </div>
          <div className="tab-content glass">
            {activeTab === 'auth' && (
              <div className="auth-settings">
                <div className="auth-row">
                  <label>Type:</label>
                  <select
                    className="input"
                    value={request.auth?.type || 'none'}
                    onChange={(e) => setRequest(prev => ({ ...prev, auth: { ...prev.auth!, type: e.target.value as any } }))}
                  >
                    <option value="none">No Auth</option>
                    <option value="bearer">Bearer Token</option>
                    <option value="basic">Basic Auth</option>
                  </select>
                </div>
                {request.auth?.type === 'bearer' && (
                  <div className="auth-row">
                    <label>Token:</label>
                    <input
                      className="input"
                      placeholder="Token"
                      value={request.auth.token || ''}
                      onChange={(e) => setRequest(prev => ({ ...prev, auth: { ...prev.auth!, token: e.target.value } }))}
                    />
                  </div>
                )}
                {request.auth?.type === 'basic' && (
                  <div className="auth-col">
                    <div className="auth-row">
                      <label>Username:</label>
                      <input
                        className="input"
                        placeholder="Username"
                        value={request.auth.username || ''}
                        onChange={(e) => setRequest(prev => ({ ...prev, auth: { ...prev.auth!, username: e.target.value } }))}
                      />
                    </div>
                    <div className="auth-row">
                      <label>Password:</label>
                      <input
                        type="password"
                        className="input"
                        placeholder="Password"
                        value={request.auth.password || ''}
                        onChange={(e) => setRequest(prev => ({ ...prev, auth: { ...prev.auth!, password: e.target.value } }))}
                      />
                    </div>
                  </div>
                )}
              </div>
            )}
            {activeTab === 'headers' && (
              <div className="headers-editor">
                {request.headers.map((h, i) => (
                  <div key={i} className="row">
                    <input className="input" placeholder="Key" value={h.key} onChange={(e) => updateHeader(i, 'key', e.target.value)} />
                    <input className="input" placeholder="Value" value={h.value} onChange={(e) => updateHeader(i, 'value', e.target.value)} />
                  </div>
                ))}
                <button className="btn btn-ghost" onClick={addHeader}>+ Add Header</button>
              </div>
            )}
            {activeTab === 'body' && (
              <textarea
                className="body-editor input"
                placeholder='{"key": "value"}'
                value={request.body}
                onChange={(e) => setRequest(prev => ({ ...prev, body: e.target.value }))}
              />
            )}
            {activeTab === 'scan' && (
              <div className="scan-settings">
                <label>Vulnerability Type:</label>
                <select
                  className="input"
                  value={request.scanType}
                  onChange={(e) => setRequest(prev => ({ ...prev, scanType: e.target.value }))}
                >
                  <option value="all">All</option>
                  <option value="sql">SQL Injection</option>
                  <option value="xss">XSS</option>
                  <option value="path">Path Traversal</option>
                  <option value="ssrf">SSRF</option>
                  <option value="idor">IDOR</option>
                </select>
              </div>
            )}
          </div>
        </section>

        <section className="response-viewer">
          <div className="response-header-container">
            <div className="response-tabs">
              <button className={`res-tab ${responseTab === 'body' ? 'active' : ''}`} onClick={() => setResponseTab('body')}>Body</button>
              <button className={`res-tab ${responseTab === 'headers' ? 'active' : ''}`} onClick={() => setResponseTab('headers')}>Headers</button>
              <button className={`res-tab ${responseTab === 'scan' ? 'active' : ''}`} onClick={() => setResponseTab('scan')}>Raw Output</button>
            </div>
            {response && (
              <div className="response-meta">
                <span className={`badge status ${response.status.includes('200') ? 'success' : ''}`}>{response.status}</span>
                <span className="badge time">{response.time}</span>
                <span className="badge size">{response.size}</span>
              </div>
            )}
          </div>
          <div className="response-body glass">
            {response ? (
              <div className="response-content">
                {responseTab === 'body' && <pre>{response.body}</pre>}
                {responseTab === 'headers' && (
                  <div className="headers-view">
                    <div className="headers-section">
                      <h4>Response Headers</h4>
                      {Object.entries(response.headers).map(([k, v]) => (
                        <div key={k} className="header-row">
                          <span className="header-key">{k}:</span>
                          <span className="header-val">{v}</span>
                        </div>
                      ))}
                    </div>
                    {response.requestHeaders && Object.keys(response.requestHeaders).length > 0 && (
                      <div className="headers-section">
                        <h4>Request Headers</h4>
                        {Object.entries(response.requestHeaders).map(([k, v]) => (
                          <div key={k} className="header-row">
                            <span className="header-key">{k}:</span>
                            <span className="header-val">{v}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                {responseTab === 'scan' && <pre>{response.fullOutput}</pre>}
              </div>
            ) : (
              <div className="empty-state">Send a request to see the response</div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}

export default App;
