import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { createClient } from "@supabase/supabase-js";

// ── Supabase client ──────────────────────────────────────────────────────────
const SUPA_URL  = import.meta.env.VITE_SUPABASE_URL  || "";
const SUPA_KEY  = import.meta.env.VITE_SUPABASE_ANON_KEY || "";
const supabase  = SUPA_URL && SUPA_KEY ? createClient(SUPA_URL, SUPA_KEY) : null;

// ── Storage adapter — drop-in replacement for window.storage ─────────────────
// All data is scoped per authenticated user via RLS.
// Files (docs/photos) go to Supabase Storage; everything else to user_storage table.
const supaStorage = {
  async get(key) {
    if (!supabase) return null;
    try {
      const { data, error } = await supabase
        .from("user_storage")
        .select("value")
        .eq("key", key)
        .maybeSingle();
      if (error || !data) return null;
      return { value: data.value };
    } catch { return null; }
  },
  async set(key, value) {
    if (!supabase) return null;
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const { error } = await supabase
        .from("user_storage")
        .upsert({ user_id: user.id, key, value }, { onConflict: "user_id,key" });
      return error ? null : { key, value };
    } catch { return null; }
  },
  async delete(key) {
    if (!supabase) return null;
    try {
      const { error } = await supabase
        .from("user_storage")
        .delete()
        .eq("key", key);
      return error ? null : { key, deleted: true };
    } catch { return null; }
  },
  // File upload → Supabase Storage, returns public-ish URL for the session
  async uploadFile(path, blob, contentType) {
    if (!supabase) return null;
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const fullPath = `${user.id}/${path}`;
      const { error } = await supabase.storage
        .from("meridian-files")
        .upload(fullPath, blob, { contentType, upsert: true });
      if (error) return null;
      return fullPath;
    } catch { return null; }
  },
  async getFileURL(path) {
    if (!supabase) return null;
    try {
      const { data } = await supabase.storage
        .from("meridian-files")
        .createSignedUrl(path, 3600);
      return data?.signedUrl || null;
    } catch { return null; }
  },
  async deleteFile(path) {
    if (!supabase) return null;
    try {
      await supabase.storage.from("meridian-files").remove([path]);
    } catch {}
  },
};

// ── Auth wrapper component ────────────────────────────────────────────────────
function AuthGate({ children }) {
  const [session, setSession] = useState(undefined); // undefined = loading
  const [authMode, setAuthMode] = useState("login"); // login | signup | reset
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!supabase) { setSession(null); return; }
    supabase.auth.getSession().then(({ data: { session } }) => setSession(session));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => subscription.unsubscribe();
  }, []);

  // No Supabase configured — run in local mode (window.storage fallback)
  if (!supabase || (SUPA_URL === "" && SUPA_KEY === "")) {
    return children;
  }

  // Loading
  if (session === undefined) {
    return (
      <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100vh",background:"#0f172a"}}>
        <div style={{fontSize:13,color:"#475569"}}>Loading…</div>
      </div>
    );
  }

  // Authenticated — render app
  if (session) return children;

  // ── Auth forms ──
  const submit = async () => {
    setBusy(true); setError(""); setInfo("");
    try {
      if (authMode === "login") {
        const { error: e } = await supabase.auth.signInWithPassword({ email, password });
        if (e) setError(e.message);
      } else if (authMode === "signup") {
        const { error: e } = await supabase.auth.signUp({ email, password, options: { data: { full_name: name } } });
        if (e) setError(e.message);
        else setInfo("Check your email to confirm your account, then log in.");
      } else {
        const { error: e } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.href });
        if (e) setError(e.message);
        else setInfo("Password reset email sent. Check your inbox.");
      }
    } catch(e) { setError(e.message); }
    setBusy(false);
  };

  return (
    <div style={{display:"flex",alignItems:"center",justifyContent:"center",width:"100vw",height:"100vh",minHeight:"100vh",background:"#0f172a",fontFamily:"Inter,system-ui,sans-serif",position:"fixed",top:0,left:0,right:0,bottom:0}}>
      <div style={{width:"100%",maxWidth:420,padding:"0 24px"}}>
        {/* Brand */}
        <div style={{marginBottom:32,textAlign:"center"}}>
          <img src={LOGO} alt="Meridian Properties" style={{width:"100%",maxWidth:320,height:"auto",display:"block",margin:"0 auto 12px"}}/>
          <div style={{fontSize:10,color:"#334155",letterSpacing:".18em",textTransform:"uppercase"}}>Mortgage Portfolio OS</div>
        </div>

        {/* Card */}
        <div style={{background:"#1e293b",border:"1px solid rgba(255,255,255,.07)",borderRadius:16,padding:"28px 28px 24px",boxShadow:"0 20px 60px rgba(0,0,0,.4)"}}>
          <div style={{fontSize:16,fontWeight:700,color:"#f1f5f9",marginBottom:4}}>
            {authMode==="login"?"Sign in":authMode==="signup"?"Create account":"Reset password"}
          </div>
          <div style={{fontSize:11,color:"#64748b",marginBottom:22}}>
            {authMode==="login"?"Access your portfolio dashboard":authMode==="signup"?"Set up your team account":"We'll email you a reset link"}
          </div>

          {authMode==="signup"&&<div style={{marginBottom:12}}>
            <label style={{fontSize:11,fontWeight:600,color:"#94a3b8",display:"block",marginBottom:5,letterSpacing:".04em"}}>FULL NAME</label>
            <input value={name} onChange={e=>setName(e.target.value)} placeholder="Maria Lopez"
              style={{width:"100%",padding:"10px 14px",background:"#0f172a",border:"1px solid rgba(255,255,255,.1)",borderRadius:9,fontSize:13,color:"#f1f5f9",outline:"none"}}/>
          </div>}

          <div style={{marginBottom:12}}>
            <label style={{fontSize:11,fontWeight:600,color:"#94a3b8",display:"block",marginBottom:5,letterSpacing:".04em"}}>EMAIL</label>
            <input value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@meridian.com" type="email" onKeyDown={e=>e.key==="Enter"&&submit()}
              style={{width:"100%",padding:"10px 14px",background:"#0f172a",border:"1px solid rgba(255,255,255,.1)",borderRadius:9,fontSize:13,color:"#f1f5f9",outline:"none"}}/>
          </div>

          {authMode!=="reset"&&<div style={{marginBottom:20}}>
            <label style={{fontSize:11,fontWeight:600,color:"#94a3b8",display:"block",marginBottom:5,letterSpacing:".04em"}}>PASSWORD</label>
            <input value={password} onChange={e=>setPassword(e.target.value)} placeholder="••••••••••••" type="password" onKeyDown={e=>e.key==="Enter"&&submit()}
              style={{width:"100%",padding:"10px 14px",background:"#0f172a",border:"1px solid rgba(255,255,255,.1)",borderRadius:9,fontSize:13,color:"#f1f5f9",outline:"none"}}/>
          </div>}

          {error&&<div style={{padding:"9px 13px",background:"rgba(220,38,38,.15)",border:"1px solid rgba(220,38,38,.3)",borderRadius:8,fontSize:12,color:"#fca5a5",marginBottom:14}}>{error}</div>}
          {info&&<div style={{padding:"9px 13px",background:"rgba(22,163,74,.15)",border:"1px solid rgba(22,163,74,.3)",borderRadius:8,fontSize:12,color:"#86efac",marginBottom:14}}>{info}</div>}

          <button onClick={submit} disabled={busy}
            style={{width:"100%",padding:"11px",background:busy?"#334155":"linear-gradient(135deg,#2563eb,#1d4ed8)",border:"none",borderRadius:10,color:"#fff",fontSize:13,fontWeight:700,cursor:busy?"default":"pointer",letterSpacing:".02em",boxShadow:busy?"none":"0 4px 14px rgba(37,99,235,.3)"}}>
            {busy?"Working…":authMode==="login"?"Sign In →":authMode==="signup"?"Create Account →":"Send Reset Email"}
          </button>

          <div style={{marginTop:18,display:"flex",justifyContent:"center",gap:20,fontSize:11}}>
            {authMode!=="login"&&<button onClick={()=>{setAuthMode("login");setError("");setInfo("");}} style={{background:"none",border:"none",color:"#64748b",cursor:"pointer",textDecoration:"underline"}}>Sign in</button>}
            {authMode!=="signup"&&<button onClick={()=>{setAuthMode("signup");setError("");setInfo("");}} style={{background:"none",border:"none",color:"#64748b",cursor:"pointer",textDecoration:"underline"}}>Create account</button>}
            {authMode!=="reset"&&<button onClick={()=>{setAuthMode("reset");setError("");setInfo("");}} style={{background:"none",border:"none",color:"#64748b",cursor:"pointer",textDecoration:"underline"}}>Forgot password</button>}
          </div>
        </div>

        <div style={{textAlign:"center",marginTop:20,fontSize:10,color:"#334155"}}>
          Meridian Properties · Internal Use Only
        </div>
      </div>
    </div>
  );
}

const LOGO = "data:image/png;base64,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sczD7CY7hcInaGvI5sYf9z2n2/8AV9cDa92jn4skqsCYErHMw+wmO4XCJ2hryObGH/c9p9v/AFfXVZREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBEUo2PZ9zhvdlorza8FVFTQV1OyppphV04Ekb2hzXaGQEagg8Rqgi5FLve053+IVT8tpvrE72nO/xCqfltN9YgiJFLve053+IVT8tpvrE72nO/xCqfltN9YgiJFLve053+IVT8tpvrE72nO/xCqfltN9YgiJFLve053+IVT8tpvrE72nO/xCqfltN9YgiJFLve053+IVT8tpvrE72nO/xCqfltN9YgiJFLve053+IVT8tpvrE72nO/xCqfltN9YgiJFLve053+IVT8tpvrE72nO/xCqfltN9YgiJFLve053+IVT8tpvrE72nO/xCqfltN9YgiJFLve053+IVT8tpvrE72nO/xCqfltN9YgiJFLve053+IVT8tpvrE72nO/xCqfltN9YgiJFLve053+IVT8tpvrE72nO/xCqfltN9YgiJFLve053+IVT8tpvrE72nO/xCqfltN9YgiJFLve053+IVT8tpvrE72nO/xCqfltN9YgiJFLve053+IVT8tpvrE72nO/xCqfltN9YgiJFLve053+IVT8tpvrE72nO/xCqfltN9YgiJFLve053+IVT8tpvrE72nO/xCqfltN9YgiJT/s/Zw9ydz4TxZVfwbhHQ10jvuXUI5D+D2O6uR4csd72nO/xCqfltN9Yne053+IVT8tpvrFS39Cnepmq2PpPvE+YTUX5059WK2JC4KqWGmp5KiolZFDE0vkke4Na1oGpJJ5ALDMj8K502WgFgxrgyvNBAz+CV3dMMr4gP/DcGvLnDsIBI5cuXiZ64Ez0xfM+x2DA9dDYWO8N5q6dj6wjrcDJqGDqafOeoDn1f9N7c7f6fKP9Mf3e3L/PyZ3LiFUVdcd/CIc9c15cV1ElisUr4rFE7R7xqHVbgeZ7Gdg6+Z6gIkUu97Tnf4hVPy2m+sTvac7/ABCqfltN9YuiaenVp1RVVHKI/wC/nLAW25W5dWSOsG4mveD8SUeIsO18tDcqN+/FKw/G1w5OaRwIPAgrZPs4Z2WTN3De83oqHEdGwemNu3uXV0sevF0ZPwtJ0PUTR3vac7/EKp+W031i9fBuR+0Xg/ElHiLDuEq6huVG/filZW03wtcOk0c0jgQeBBVpG2SL5keyKN0kj2sYwFznOOgAHMkrG8sr1iS+YTpqvF2GZsOXto3KukdIyRhcPbxuY5w3D1AnUcjrwJgza0bnhjSObBeAMHV8eHHDSurxVQRvr/8AhtBkDmxduoBd5vXBE217tHPxZJVYEwJWOZh9hMdwuETtDXkc2MP+57T7f+r66rKl3vac7/EKp+W031id7Tnf4hVPy2m+sQREil3vac7/ABCqfltN9Yne053+IVT8tpvrEERIpd72nO/xCqfltN9Yne053+IVT8tpvrEERIpd72nO/wAQqn5bTfWJ3tOd/iFU/Lab6xBESKXe9pzv8Qqn5bTfWJ3tOd/iFU/Lab6xBESKXe9pzv8AEKp+W031id7Tnf4hVPy2m+sQREil3vac7/EKp+W031id7Tnf4hVPy2m+sQREil3vac7/ABCqfltN9Yne053+IVT8tpvrEERIpd72nO/xCqfltN9Yne053+IVT8tpvrEERIpd72nO/wAQqn5bTfWJ3tOd/iFU/Lab6xBESKXe9pzv8Qqn5bTfWJ3tOd/iFU/Lab6xBESKXe9pzv8AEKp+W031id7Tnf4hVPy2m+sQREil3vac7/EKp+W031id7Tnf4hVPy2m+sQREil3vac7/ABCqfltN9Yne053+IVT8tpvrEERIpd72nO/xCqfltN9Yne053+IVT8tpvrEERIpd72nO/wAQqn5bTfWJ3tOd/iFU/Lab6xBESKXe9pzv8Qqn5bTfWJ3tOd/iFU/Lab6xBESKVLps75y2y2VVyrsEVMNJSQvnnkNXTkMYxpc52gk1OgBPBRWgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAiIgIiICIiAsqoMyMxKCigoaHHuKqWkp42xQwQ3eoZHExo0a1rQ/QAAAADksVRBmHqp5ne6PjD57qfpp6qeZ3uj4w+e6n6aw9EGYeqnmd7o+MPnup+mnqp5ne6PjD57qfprD0QZh6qeZ3uj4w+e6n6aeqnmd7o+MPnup+msPRBmHqp5ne6PjD57qfpp6qeZ3uj4w+e6n6aw9EGYeqnmd7o+MPnup+mnqp5ne6PjD57qfprD0QZh6qeZ3uj4w+e6n6aeqnmd7o+MPnup+msPRBmHqp5ne6PjD57qfpp6qeZ3uj4w+e6n6aw9EGYeqnmd7o+MPnup+mnqp5ne6PjD57qfprD0QZh6qeZ3uj4w+e6n6aeqnmd7o+MPnup+msPRBmHqp5ne6PjD57qfpp6qeZ3uj4w+e6n6aw9EGYeqnmd7o+MPnup+mnqp5ne6PjD57qfprD0QZh6qeZ3uj4w+e6n6aeqnmd7o+MPnup+msPRBmHqp5ne6PjD57qfpp6qeZ3uj4w+e6n6aw9EGYeqnmd7o+MPnup+mnqp5ne6PjD57qfprD0QZh6qeZ3uj4w+e6n6aeqnmd7o+MPnup+msPRBmHqp5ne6PjD57qfpp6qeZ3uj4w+e6n6aw9EGYeqnmd7o+MPnup+mnqp5ne6PjD57qfprD0QZh6qeZ3uj4w+e6n6aeqnmd7o+MPnup+msPRBmHqp5ne6PjD57qfpp6qeZ3uj4w+e6n6aw9EGYeqnmd7o+MPnup+mnqp5ne6PjD57qfprD0QZiM1MzxyzHxh891P01+eqnmd7o+MPnup+msPRBmHqp5ne6PjD57qfpp6qeZ3uj4w+e6n6aw9EGYeqnmd7o+MPnup+mnqp5ne6PjD57qfprD0QZh6qeZ3uj4w+e6n6aeqnmd7o+MPnup+msPRBmHqp5ne6PjD57qfpp6qeZ3uj4w+e6n6aw9EGYeqnmd7o+MPnup+mnqp5ne6PjD57qfprD0QZh6qeZ3uj4w+e6n6aeqnmd7o+MPnup+msPRBmHqp5ne6PjD57qfpp6qeZ3uj4w+e6n6aw9EGYeqnmd7o+MPnup+mnqp5ne6PjD57qfprD0QZh6qeZ3uj4w+e6n6aeqnmd7o+MPnup+msPRBmHqp5ne6PjD57qfpp6qeZ3uj4w+e6n6aw9EGYeqnmd7o+MPnup+mnqp5ne6PjD57qfprD0QZh6qeZ3uj4w+e6n6aeqnmd7o+MPnup+msPRBmHqp5ne6PjD57qfpp6qeZ3uj4w+e6n6aw9EGYeqnmd7o+MPnup+mnqp5ne6PjD57qfprD0QZh6qeZ3uj4w+e6n6aeqnmd7o+MPnup+msPRBmHqp5ne6PjD57qfpp6qeZ3uj4w+e6n6aw9EGYeqnmd7o+MPnup+mnqp5ne6PjD57qfprD0QZZVZl5j1dLLS1WYGLJ6eZhjlikvFQ5j2kaFrgX6EEHQgrE0RAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQd0Wm6Eai21hB/wCA7/RdeppqimcGVMEsLjyEjC0/lWxHaYzqv2TuG8GyWO1Wy4G6wytlFYH+B0TIdN3dcOfSHXXsCjvKzafp8zsW0GAsxsC2WegvUwpIpImmRjZX8GB0cm9qCdBqCCNdUFLV9RsfLI2ONjnvcdGtaNST5ApL2nsBUGXGct3w7ad4WsiOqomPcXGOORu9uanid1280E8SANeK6Wzh7PeB/fum/aBBhnpTdf5srf8AoO/0XzJbLlHG6SS31bGNGrnOhcAB2ngr17TW0lirKzMw4Ws9istbTChiqelqhLv7zy7UeC4DTh2KGcZbXuNsUYRvGG6vDOHoae60M1FLJEJt9jZWFhLdXkagHhqgreiLlo6aesq4aSlifNUTyNjijYNXPc46AAdpJQfUdJVyU7qiOlnfC3XekbGS0ac9TyXAtl+X9Pg/LmzYRyCurYp7he7NVSVbNRuTSEazB3WQ/WYN8kWnYtfObWDqvAOY17wlWbxdb6pzIpHDQywnwo3/AOJhafhQYsuaOkqpKd1RHTTPhZrvSNYS0adp5LhVxtnn7xDMj+0uP7rCgpyiIgIiIOzT0FdUR9JT0VTMzXTeZE5w184C5PSm6/zZW/8AQd/orsbL+KazBOxffsV0FPBU1VsrKqeKKfXceR0Y0OhB049RWAd+1j7xTwz8U/1iCr1TTz00nR1EEsL9Nd2RhadO3QriWd53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";

const TODAY = new Date("2026-02-19");
const TODAY_STR = "2026-02-19";
const MKT = { Fixed:6.50, ARM:6.25, Bridge:10.50, IO:6.75, SOFR:6.40 };
const REFI_STAGES = ["Not Started","Exploring","LOI Received","Application Submitted","Appraisal Ordered","Commitment Issued","Closed"];
const ACT_TYPES = [{id:"call",icon:"📞",label:"Call"},{id:"email",icon:"✉️",label:"Email"},{id:"meeting",icon:"🤝",label:"Meeting"},{id:"document",icon:"📄",label:"Doc"},{id:"note",icon:"📝",label:"Note"}];

const mosBetween=(a,b)=>{const d1=new Date(a),d2=new Date(b);return(d2.getFullYear()-d1.getFullYear())*12+(d2.getMonth()-d1.getMonth());};
const calcPmt=(p,r,n)=>{const mr=r/100/12;if(!mr||n<=0)return 0;return p*(mr*Math.pow(1+mr,n))/(Math.pow(1+mr,n)-1);};
const calcBal=(p,r,n,t)=>{const mr=r/100/12;if(!mr)return Math.max(0,p-(p/n)*t);const pm=calcPmt(p,r,n);return Math.max(0,p*Math.pow(1+mr,t)-pm*((Math.pow(1+mr,t)-1)/mr));};
const daysTo=s=>{if(!s||s==="")return null;const d=new Date(s);if(isNaN(d))return null;return Math.round((d-TODAY)/86400000);};
const matSt=s=>{const d=daysTo(s);if(d===null)return"unknown";if(d<0)return"matured";if(d<=180)return"urgent";if(d<=365)return"soon";return"ok";};
const enrich=loan=>{
  const el=mosBetween(loan.origDate,TODAY_STR);
  const amM=(loan.amortYears||loan.termYears||1)*12;
  const cb=loan.interestOnly?loan.origBalance:Math.max(0,calcBal(loan.origBalance,loan.rate,amM,el));
  const pmt=loan.interestOnly?loan.origBalance*(loan.rate/100/12):calcPmt(loan.origBalance,loan.rate,amM);
  const mr=MKT[loan.loanType]||6.5;
  const mpmt=calcPmt(Math.max(0,cb),mr,Math.max(1,amM-el));
  const pp=loan.origBalance>0?Math.max(0,(loan.origBalance-cb)/loan.origBalance*100):0;
  const dl=daysTo(loan.maturityDate);
  const capExp=loan.capExpiry&&loan.loanType==="ARM"&&dl!=null&&daysTo(loan.capExpiry)<dl;
  const dscr=loan.annualNOI&&pmt>0?loan.annualNOI/(pmt*12):null;
  // Use actual currentBalance from DB if available, else calculated
  const actualBal=loan.currentBalance&&loan.currentBalance>0?loan.currentBalance:cb;
  return{...loan,curBal:actualBal,pmt,annualDS:pmt*12,marketPmt:mpmt,paidPct:pp,daysLeft:dl,status:matSt(loan.maturityDate),capExpiring:capExp,dscr};
};

const f$=n=>{if(!n&&n!==0)return"—";if(Math.abs(n)>=1e6)return`$${(n/1e6).toFixed(2)}M`;if(Math.abs(n)>=1e3)return`$${(n/1e3).toFixed(0)}K`;return`$${Math.round(n).toLocaleString()}`;};
const fPct=n=>n!=null&&n!==""?`${Number(n).toFixed(3)}%`:"—";
const fDate=s=>s?new Date(s).toLocaleDateString("en-US",{month:"long",year:"numeric"}):"—";
const fDateS=s=>s?new Date(s).toLocaleDateString("en-US",{month:"short",year:"numeric"}):"—";
const fDateF=s=>s?new Date(s).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}):"—";

const LOANS_INIT=[];


/* ─────────────────────────── CSS ────────────────────────────────────────── */
const CSS=`
@import url('https://fonts.googleapis.com/css2?family=Inter:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
html{height:100%;width:100%;}
body{height:100%;width:100%;background:var(--bg);color:var(--t1);font-family:var(--f);font-size:13px;-webkit-font-smoothing:antialiased;overflow:hidden;}
#root,#__next,[data-reactroot]{height:100%;width:100%;display:flex;flex-direction:column;}
:root{
  --bg:#f4f6f9;
  --white:#fff;
  --bd:#e5e7eb;
  --bd2:#d1d5db;
  --t1:#0f172a;
  --t2:#334155;
  --t3:#64748b;
  --t4:#94a3b8;
  --green:#16a34a;--gbg:#f0fdf4;--gbd:#bbf7d0;
  --red:#dc2626;--rbg:#fef2f2;--rbd:#fecaca;
  --amber:#d97706;--abg:#fffbeb;--abd:#fde68a;
  --blue:#2563eb;--bbg:#eff6ff;--bbd:#bfdbfe;
  --sb:#0f172a;
  --sb2:#1e293b;
  --sb3:#263045;
  --sb-bd:#ffffff0f;
  --sb-t1:#f1f5f9;
  --sb-t2:#94a3b8;
  --sb-t3:#475569;
  --sb-acc:#3b82f6;
  --f:'Inter',system-ui,sans-serif;
}
button{font-family:var(--f);cursor:pointer;}
input,select,textarea{font-family:var(--f);}
::-webkit-scrollbar{width:5px;height:5px;}
::-webkit-scrollbar-track{background:transparent;}
::-webkit-scrollbar-thumb{background:rgba(0,0,0,.15);border-radius:3px;}

/* SHELL */
.shell{display:flex;width:100%;height:100vh;min-height:100vh;overflow:hidden;position:fixed;top:0;left:0;right:0;bottom:0;}

/* ── SIDEBAR ── */
.sb{width:248px;flex-shrink:0;background:var(--sb);display:flex;flex-direction:column;overflow:hidden;box-shadow:2px 0 24px rgba(0,0,0,.18);}

/* Brand */
.sb-hd{padding:0;border-bottom:1px solid var(--sb-bd);}
.sb-brand{padding:24px 18px 20px;position:relative;overflow:hidden;background:linear-gradient(160deg,#0f172a 0%,#1a243c 60%,#0f172a 100%);}
.sb-brand::before{content:"";position:absolute;inset:0;background:radial-gradient(ellipse at 20% 60%,rgba(212,175,55,.07) 0%,transparent 65%),radial-gradient(ellipse at 80% 20%,rgba(212,175,55,.05) 0%,transparent 55%);pointer-events:none;}
.sb-brand::after{content:"";position:absolute;bottom:-1px;left:18px;right:18px;height:1px;background:linear-gradient(90deg,transparent,rgba(212,175,55,.3),transparent);}

.sb-monogram{width:44px;height:44px;flex-shrink:0;position:relative;margin-bottom:14px;}
.sb-monogram-bg{position:absolute;inset:0;background:linear-gradient(145deg,#c9a84c 0%,#f0d070 35%,#c9a84c 65%,#a8882a 100%);border-radius:12px;box-shadow:0 4px 16px rgba(212,175,55,.35),inset 0 1px 0 rgba(255,255,255,.25);}
.sb-monogram-letter{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:800;color:#0f172a;letter-spacing:-.02em;font-style:italic;}

.sb-wordmark{display:flex;flex-direction:column;gap:1px;position:relative;}
.sb-firm-name{font-size:17px;font-weight:700;color:#f8f4ea;letter-spacing:.01em;line-height:1.1;}
.sb-firm-name em{font-style:normal;color:#d4af37;}
.sb-firm-type{font-size:9px;font-weight:600;color:rgba(212,175,55,.7);letter-spacing:.2em;text-transform:uppercase;margin-top:4px;}
.sb-firm-rule{height:1px;background:linear-gradient(90deg,rgba(212,175,55,.4),transparent);margin-top:8px;width:100%;}
.sb-firm-meta{font-size:9px;color:rgba(148,163,184,.6);letter-spacing:.08em;margin-top:7px;font-weight:400;}

/* Search */
.sb-search{position:relative;}
.sb-search input{width:100%;padding:8px 11px 8px 32px;background:var(--sb2);border:1px solid var(--sb-bd);border-radius:9px;font-size:12px;color:var(--sb-t1);outline:none;transition:border-color .15s;}
.sb-search input::placeholder{color:var(--sb-t3);}
.sb-search input:focus{border-color:rgba(59,130,246,.5);background:var(--sb3);}
.sb-si{position:absolute;left:10px;top:50%;transform:translateY(-50%);font-size:12px;color:var(--sb-t3);pointer-events:none;}

/* Nav */
.sb-nav{flex:1;overflow-y:auto;padding:8px 10px 12px;}
.sb-nav::-webkit-scrollbar-thumb{background:rgba(255,255,255,.08);}
.sb-sec{padding:14px 8px 5px;font-size:9px;font-weight:700;color:var(--sb-t3);letter-spacing:.12em;text-transform:uppercase;}

.sb-row{display:flex;align-items:center;justify-content:space-between;padding:9px 10px;border-radius:9px;cursor:pointer;transition:background .12s;margin-bottom:1px;}
.sb-row:hover{background:var(--sb2);}
.sb-row.act{background:linear-gradient(90deg,rgba(59,130,246,.22),rgba(59,130,246,.08));border:1px solid rgba(59,130,246,.25);}
.sb-row.act .sb-rlbl{color:var(--sb-t1);font-weight:700;}
.sb-row.act .sb-ri{color:#60a5fa;}

.sb-rl{display:flex;align-items:center;gap:10px;}
.sb-ri{font-size:15px;width:18px;text-align:center;flex-shrink:0;color:var(--sb-t2);transition:color .12s;}
.sb-rtxt{}
.sb-rlbl{font-size:12px;font-weight:500;color:var(--sb-t2);transition:color .12s;}
.sb-row:hover .sb-rlbl{color:var(--sb-t1);}
.sb-row:hover .sb-ri{color:var(--sb-t1);}
.sb-rsub{font-size:10px;color:var(--sb-t3);margin-top:1px;}

.sb-badge{padding:2px 8px;border-radius:20px;font-size:10px;font-weight:700;min-width:20px;text-align:center;}
.bg-green{background:rgba(34,197,94,.15);color:#4ade80;}
.bg-red{background:rgba(239,68,68,.2);color:#f87171;}
.bg-amber{background:rgba(251,191,36,.15);color:#fbbf24;}
.bg-grey{background:rgba(255,255,255,.06);color:var(--sb-t3);}

.sb-div{height:1px;background:var(--sb-bd);margin:8px 10px;}

/* Grouped nav */
.sb-group{margin-bottom:2px;}
.sb-group-hd{display:flex;align-items:center;justify-content:space-between;padding:10px 10px 5px;cursor:pointer;user-select:none;border-radius:8px;transition:background .12s;}
.sb-group-hd:hover{background:var(--sb2);}
.sb-group-label{font-size:9px;font-weight:800;color:var(--sb-t3);letter-spacing:.14em;text-transform:uppercase;display:flex;align-items:center;gap:7px;}
.sb-group-icon{font-size:11px;opacity:.7;}
.sb-group-caret{font-size:9px;color:var(--sb-t3);transition:transform .2s;opacity:.6;}
.sb-group-caret.open{transform:rotate(90deg);}
.sb-group-items{overflow:hidden;transition:max-height .2s ease;}

/* Footer */
.sb-ft{padding:14px 16px;border-top:1px solid var(--sb-bd);}
.sb-user{display:flex;align-items:center;gap:10px;}
.sb-av{width:32px;height:32px;background:linear-gradient(135deg,#3b82f6,#8b5cf6);border-radius:50%;color:#fff;font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;}
.sb-uname{font-size:12px;font-weight:600;color:var(--sb-t1);}
.sb-urole{font-size:10px;color:var(--sb-t3);margin-top:1px;}
.sb-dot{width:7px;height:7px;border-radius:50%;background:#4ade80;border:1.5px solid var(--sb);margin-left:auto;flex-shrink:0;}

/* MAIN */
.main{flex:1;display:flex;flex-direction:column;overflow:hidden;background:var(--bg);}

/* TOPBAR */
.topbar{height:58px;background:var(--white);border-bottom:1px solid var(--bd);display:flex;align-items:center;justify-content:space-between;padding:0 28px;flex-shrink:0;box-shadow:0 1px 0 var(--bd);}
.tb-left{display:flex;align-items:center;gap:12px;}
.tb-back{width:28px;height:28px;background:var(--bg);border:1px solid var(--bd2);border-radius:8px;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:13px;color:var(--t3);transition:all .12s;}
.tb-back:hover{background:var(--bd);color:var(--t1);}
.tb-title{font-size:16px;font-weight:800;color:var(--t1);letter-spacing:-.02em;}
.tb-right{display:flex;gap:8px;align-items:center;}
.btn-dark{padding:8px 16px;background:var(--t1);color:#fff;border:none;border-radius:9px;font-size:12px;font-weight:600;display:flex;align-items:center;gap:6px;cursor:pointer;transition:all .15s;letter-spacing:.01em;}
.btn-dark:hover{background:#1e293b;transform:translateY(-1px);box-shadow:0 4px 12px rgba(15,23,42,.25);}
.btn-dark:active{transform:translateY(0);}
.btn-light{padding:8px 16px;background:var(--white);color:var(--t2);border:1px solid var(--bd2);border-radius:9px;font-size:12px;font-weight:500;cursor:pointer;display:flex;align-items:center;gap:6px;transition:all .12s;}
.btn-light:hover{background:var(--bg);border-color:var(--t4);}

/* CONTENT AREA */
.carea{flex:1;overflow-y:auto;padding:24px 28px;}

/* DETAIL TOP CARD */
.dtop{background:var(--white);border:1px solid var(--bd);border-radius:16px;padding:24px 28px;margin-bottom:14px;box-shadow:0 1px 4px rgba(0,0,0,.04);}
.d-addr{font-size:24px;font-weight:800;color:var(--t1);margin-bottom:3px;letter-spacing:-.02em;}
.d-ent{font-size:12px;color:var(--t3);margin-bottom:14px;}
.d-chips{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:20px;}
.chip{display:inline-flex;align-items:center;gap:5px;padding:4px 11px;border-radius:20px;font-size:11px;font-weight:600;white-space:nowrap;}
.chip-dot{width:5px;height:5px;border-radius:50%;}
.chip-green{background:var(--gbg);color:var(--green);border:1px solid var(--gbd);}
.chip-red{background:var(--rbg);color:var(--red);border:1px solid var(--rbd);}
.chip-amber{background:var(--abg);color:var(--amber);border:1px solid var(--abd);}
.chip-blue{background:var(--bbg);color:var(--blue);border:1px solid var(--bbd);}
.chip-grey{background:var(--bg);border:1px solid var(--bd2);color:var(--t3);}
.chip-dark{background:var(--t1);color:#fff;}
.d-meta-row{display:grid;grid-template-columns:repeat(4,1fr);gap:0;border-top:1px solid var(--bd);padding-top:18px;}
.dm{padding-right:20px;}
.dm-lbl{font-size:9px;font-weight:700;color:var(--t4);text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px;}
.dm-val{font-size:16px;font-weight:700;color:var(--t1);}
.dm-val.red{color:var(--red);}
.dm-val.green{color:var(--green);}
.dm-val.amber{color:var(--amber);}
.dm-val.muted{color:var(--t3);font-weight:400;}

/* DETAIL PANELS */
.dpanels{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-bottom:14px;}
.panel{background:var(--white);border:1px solid var(--bd);border-radius:14px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.03);}
.panel-hd{padding:11px 18px;border-bottom:1px solid var(--bd);font-size:9px;font-weight:700;color:var(--t3);text-transform:uppercase;letter-spacing:.1em;background:var(--bg);}
.panel-body{padding:14px 18px;}
.prow{display:flex;justify-content:space-between;align-items:baseline;padding:6px 0;border-bottom:1px solid var(--bd);}
.prow:last-child{border-bottom:none;}
.pk{font-size:11px;color:var(--t3);}
.pv{font-size:12px;font-weight:600;color:var(--t1);text-align:right;}
.pv.green{color:var(--green);}
.pv.red{color:var(--red);}
.pv.amber{color:var(--amber);}

/* HISTORY CARD */
.hist-card{background:var(--white);border:1px solid var(--bd);border-radius:14px;overflow:hidden;margin-bottom:14px;box-shadow:0 1px 3px rgba(0,0,0,.03);}
.hist-hd{display:flex;align-items:center;justify-content:space-between;padding:14px 20px;border-bottom:1px solid var(--bd);}
.hist-title{font-size:14px;font-weight:700;color:var(--t1);}
.hist-ct{font-size:11px;color:var(--t3);}
.hist-empty{padding:40px;text-align:center;}
.he-icon{font-size:26px;opacity:.15;margin-bottom:8px;}
.he-txt{font-size:12px;color:var(--t3);}
.act-entry{display:flex;gap:12px;padding:12px 20px;border-bottom:1px solid var(--bd);}
.act-entry:last-child{border-bottom:none;}
.ae-ic{width:28px;height:28px;border-radius:50%;background:var(--bg);border:1px solid var(--bd);display:flex;align-items:center;justify-content:center;font-size:12px;flex-shrink:0;}
.ae-txt{font-size:12px;color:var(--t2);line-height:1.5;margin-bottom:3px;}
.ae-meta{font-size:10px;color:var(--t4);display:flex;gap:8px;}

/* LOG FORM */
.log-form{padding:14px 20px;border-top:1px solid var(--bd);background:var(--bg);}
.lf-types{display:flex;gap:5px;margin-bottom:9px;}
.lf-tb{padding:4px 12px;background:var(--white);border:1px solid var(--bd);border-radius:20px;font-size:10px;color:var(--t3);cursor:pointer;transition:all .12s;}
.lf-tb:hover{border-color:var(--bd2);color:var(--t1);}
.lf-tb.sel{background:var(--t1);border-color:var(--t1);color:#fff;}
.lf-row{display:flex;gap:7px;}
.lf-inp{flex:1;padding:8px 12px;background:var(--white);border:1px solid var(--bd);border-radius:9px;color:var(--t1);font-size:12px;outline:none;transition:border-color .12s;}
.lf-inp:focus{border-color:var(--bd2);}
.lf-sub{padding:8px 16px;background:var(--t1);border:none;border-radius:9px;color:#fff;font-size:11px;font-weight:600;transition:all .12s;}
.lf-sub:hover{background:#1e293b;}

/* OVERVIEW / STAT CARDS */
.ov-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:20px;}
.scard{background:var(--white);border:1px solid var(--bd);border-radius:14px;padding:18px 20px;box-shadow:0 1px 3px rgba(0,0,0,.04);transition:box-shadow .15s;}
.scard:hover{box-shadow:0 4px 12px rgba(0,0,0,.07);}
.sc-lbl{font-size:9px;font-weight:700;color:var(--t4);text-transform:uppercase;letter-spacing:.08em;margin-bottom:9px;}
.sc-val{font-size:24px;font-weight:800;color:var(--t1);line-height:1;margin-bottom:5px;letter-spacing:-.02em;}
.sc-val.red{color:var(--red);}
.sc-val.green{color:var(--green);}
.sc-val.amber{color:var(--amber);}
.sc-val.blue{color:var(--blue);}
.sc-sub{font-size:11px;color:var(--t3);}

/* ALERTS */
.al-list{display:flex;flex-direction:column;gap:7px;margin-bottom:20px;}
.al-row{display:flex;gap:12px;align-items:flex-start;padding:12px 16px;border-radius:12px;border:1px solid;cursor:pointer;transition:transform .1s,box-shadow .1s;}
.al-row:hover{transform:translateX(2px);}
.al-red{background:var(--rbg);border-color:var(--rbd);}
.al-amber{background:var(--abg);border-color:var(--abd);}
.al-blue{background:var(--bbg);border-color:var(--bbd);}
.al-ic{font-size:14px;flex-shrink:0;margin-top:1px;}
.al-hl{font-size:12px;font-weight:700;color:var(--t1);}
.al-detail{font-size:11px;color:var(--t3);margin-top:2px;}
.al-action{font-size:10px;font-weight:700;margin-top:3px;text-transform:uppercase;letter-spacing:.04em;}
.al-red .al-action{color:var(--red);}
.al-amber .al-action{color:var(--amber);}
.al-blue .al-action{color:var(--blue);}

/* TABLE */
.tbl-wrap{background:var(--white);border:1px solid var(--bd);border-radius:14px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.04);}
.tbl{width:100%;border-collapse:collapse;}
.tbl th{text-align:left;padding:10px 16px;font-size:9px;font-weight:700;color:var(--t3);text-transform:uppercase;letter-spacing:.08em;background:var(--bg);border-bottom:1px solid var(--bd);cursor:pointer;white-space:nowrap;user-select:none;}
.tbl th:hover{color:var(--t1);}
.tbl td{padding:13px 16px;border-bottom:1px solid var(--bd);vertical-align:middle;}
.tbl tbody tr:last-child td{border-bottom:none;}
.tbl tbody tr{cursor:pointer;transition:background .1s;}
.tbl tbody tr:hover{background:#fafbfc;}
.td-a{font-size:13px;font-weight:700;color:var(--t1);}
.td-b{font-size:10px;color:var(--t3);margin-top:2px;}
.td-n{font-size:12px;font-weight:600;color:var(--t1);}
.td-n.green{color:var(--green);}
.td-n.red{color:var(--red);}
.td-n.amber{color:var(--amber);}
.td-n.muted{color:var(--t3);}

/* FILTER ROW */
.frow{display:flex;gap:6px;margin-bottom:16px;flex-wrap:wrap;align-items:center;}
.fb{padding:6px 14px;background:var(--white);border:1px solid var(--bd2);border-radius:20px;font-size:11px;font-weight:500;color:var(--t3);cursor:pointer;transition:all .12s;}
.fb:hover{border-color:var(--t4);color:var(--t1);}
.fb.fa{background:var(--t1);border-color:var(--t1);color:#fff;}
.fb.fred{background:var(--rbg);border-color:var(--rbd);color:var(--red);}
.fb.fgreen{background:var(--gbg);border-color:var(--gbd);color:var(--green);}
.f-inp{padding:6px 14px;background:var(--white);border:1px solid var(--bd2);border-radius:20px;font-size:11px;color:var(--t1);outline:none;min-width:200px;transition:border-color .12s;}
.f-inp:focus{border-color:var(--t4);}
.f-inp::placeholder{color:var(--t4);}
.f-ct{font-size:10px;color:var(--t3);margin-left:auto;}

/* REFI CALC */
.calc-layout{display:grid;grid-template-columns:310px 1fr;gap:16px;margin-bottom:24px;}
.cp{background:var(--white);border:1px solid var(--bd);border-radius:14px;padding:20px;box-shadow:0 1px 3px rgba(0,0,0,.04);}
.cp-t{font-size:14px;font-weight:700;color:var(--t1);margin-bottom:16px;}
.cp-l{font-size:9px;font-weight:700;color:var(--t3);text-transform:uppercase;letter-spacing:.07em;margin-bottom:5px;margin-top:13px;}
.cp-l:first-of-type{margin-top:0;}
.cp-i{width:100%;padding:9px 12px;background:var(--bg);border:1px solid var(--bd);border-radius:9px;color:var(--t1);font-size:13px;font-weight:500;outline:none;transition:border-color .15s;}
.cp-i:focus{border-color:var(--bd2);}
.cp-cur{background:var(--bg);border-radius:10px;padding:11px 14px;margin-top:12px;font-size:11px;color:var(--t2);line-height:1.8;border:1px solid var(--bd);}
.cp-cur strong{color:var(--t1);}
.cr-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;align-content:start;}
.crcard{background:var(--white);border:1px solid var(--bd);border-radius:13px;padding:18px 20px;box-shadow:0 1px 3px rgba(0,0,0,.04);}
.crcard.full{grid-column:span 2;}
.crcard.green{background:var(--gbg);border-color:var(--gbd);}
.crcard.red{background:var(--rbg);border-color:var(--rbd);}
.crc-l{font-size:9px;font-weight:700;color:var(--t3);text-transform:uppercase;letter-spacing:.08em;margin-bottom:9px;}
.crc-v{font-size:26px;font-weight:800;color:var(--t1);line-height:1;margin-bottom:4px;letter-spacing:-.02em;}
.crc-v.green{color:var(--green);}
.crc-v.red{color:var(--red);}
.crc-v.amber{color:var(--amber);}
.crc-s{font-size:11px;color:var(--t3);}
.pen-box{background:var(--rbg);border:1px solid var(--rbd);border-radius:13px;padding:16px 20px;margin-bottom:18px;}
.pen-l{font-size:9px;font-weight:700;color:var(--red);text-transform:uppercase;letter-spacing:.07em;margin-bottom:6px;}
.pen-v{font-size:28px;font-weight:800;color:var(--red);letter-spacing:-.02em;}
.pen-n{font-size:11px;color:var(--t3);margin-top:5px;}
.q-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:18px;}
.qcard{background:var(--white);border:1px solid var(--bd);border-radius:13px;padding:16px 18px;box-shadow:0 1px 3px rgba(0,0,0,.04);}
.qcard.best{border-color:var(--gbd);background:var(--gbg);}
.qc-hd{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;}
.qn-inp{background:transparent;border:none;font-size:13px;font-weight:700;color:var(--t1);width:100%;outline:none;}
.best-badge{font-size:9px;font-weight:700;color:#fff;background:var(--green);padding:3px 8px;border-radius:10px;}
.qrow{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;}
.qk{font-size:11px;color:var(--t3);}
.qv{font-size:12px;font-weight:600;color:var(--t1);}
.qv.green{color:var(--green);}
.qv.red{color:var(--red);}
.qi{background:transparent;border:none;font-size:12px;font-weight:600;color:var(--t1);text-align:right;width:65px;outline:none;}
.qdiv{height:1px;background:var(--bd);margin:9px 0;}

/* MISC */
.warn-box{padding:10px 14px;background:var(--rbg);border:1px solid var(--rbd);border-radius:10px;font-size:11px;color:var(--red);display:flex;gap:8px;align-items:center;margin-bottom:12px;font-weight:500;}
.sec-hdr{display:flex;align-items:baseline;justify-content:space-between;margin-bottom:14px;}
.sec-t{font-size:15px;font-weight:800;color:var(--t1);letter-spacing:-.01em;}
.sec-m{font-size:10px;color:var(--t3);font-weight:600;text-transform:uppercase;letter-spacing:.06em;}
.notes-ta{width:100%;background:var(--bg);border:1px solid var(--bd);border-radius:9px;padding:9px 12px;color:var(--t2);font-size:12px;resize:vertical;min-height:60px;outline:none;line-height:1.6;}
.notes-ta:focus{border-color:var(--bd2);}
.notes-ta::placeholder{color:var(--t4);}
.mfooter{display:flex;justify-content:flex-end;gap:8px;padding-top:14px;border-top:1px solid var(--bd);margin-top:14px;}
.copy-btn{background:transparent;border:none;padding:0 3px;color:var(--t4);font-size:10px;cursor:pointer;}
.copy-btn:hover{color:var(--green);}
.copy-btn.ok{color:var(--green);}
.refi-sel{padding:5px 10px;background:var(--bg);border:1px solid var(--bd);border-radius:8px;color:var(--t2);font-size:11px;outline:none;cursor:pointer;}

/* AMORT */
.amort-tbl{width:100%;border-collapse:collapse;font-size:11px;}
.amort-tbl th{text-align:right;padding:8px 12px;font-size:9px;font-weight:700;color:var(--t3);text-transform:uppercase;letter-spacing:.07em;border-bottom:1px solid var(--bd);background:var(--bg);}
.amort-tbl th:first-child{text-align:left;}
.amort-tbl td{text-align:right;padding:8px 12px;border-bottom:1px solid var(--bd);color:var(--t2);}
.amort-tbl td:first-child{text-align:left;color:var(--t3);}
.amort-tbl tr:hover td{background:var(--bg);}
.amort-tbl tr.yr-row td{background:var(--bg);font-weight:700;color:var(--t1);}
.amort-tbl tr.now-row td{background:var(--gbg);}
.show-more{width:100%;padding:9px;background:var(--bg);border:1px solid var(--bd);border-radius:9px;color:var(--t3);font-size:11px;cursor:pointer;margin-top:8px;transition:all .12s;}
.show-more:hover{background:var(--bd);color:var(--t1);}
.pd-bg{width:100%;height:5px;background:var(--bd);border-radius:3px;overflow:hidden;margin-top:6px;}
.pd-fill{height:5px;border-radius:3px;background:var(--green);}

/* MODAL */
.ov-modal{position:fixed;inset:0;background:rgba(15,23,42,.45);backdrop-filter:blur(4px);z-index:200;display:flex;align-items:center;justify-content:center;padding:20px;}
.ov-mbox{background:var(--white);border-radius:18px;width:100%;max-width:580px;box-shadow:0 24px 80px rgba(0,0,0,.2);overflow:hidden;max-height:90vh;display:flex;flex-direction:column;border:1px solid var(--bd);}
.ov-mhd{padding:18px 22px;border-bottom:1px solid var(--bd);display:flex;align-items:center;justify-content:space-between;flex-shrink:0;}
.ov-mtitle{font-size:16px;font-weight:800;color:var(--t1);letter-spacing:-.01em;}
.ov-mclose{width:28px;height:28px;background:var(--bg);border:1px solid var(--bd);border-radius:50%;font-size:13px;color:var(--t3);cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all .12s;}
.ov-mclose:hover{background:var(--bd);color:var(--t1);}
.ov-mbody{padding:18px 22px;overflow-y:auto;}
.fg{display:flex;flex-direction:column;gap:4px;margin-bottom:12px;}
.fg-2{display:grid;grid-template-columns:1fr 1fr;gap:12px;}
.flbl{font-size:9px;font-weight:700;color:var(--t3);text-transform:uppercase;letter-spacing:.08em;}
.finp{padding:9px 12px;background:var(--bg);border:1px solid var(--bd);border-radius:9px;color:var(--t1);font-size:12px;outline:none;width:100%;transition:border-color .12s;}
.finp:focus{border-color:var(--bd2);}
.finp::placeholder{color:var(--t4);}
.finp option{background:var(--white);}
.fsec{font-size:10px;font-weight:800;color:var(--t1);text-transform:uppercase;letter-spacing:.07em;margin:14px 0 8px;padding-bottom:6px;border-bottom:1px solid var(--bd);}
`;

/* ─────────── HELPERS ─────────── */
function CopyBtn({text}){
  const [ok,setOk]=useState(false);
  if(!text)return null;
  return <button className={`copy-btn${ok?" ok":""}`} onClick={e=>{e.stopPropagation();navigator.clipboard?.writeText(text).then(()=>{setOk(true);setTimeout(()=>setOk(false),1500);})}}>{ok?"✓":"⎘"}</button>;
}
function MatChip({loan}){
  const s=loan.status,d=loan.daysLeft;
  if(s==="unknown"||d===null||d===undefined) return <span className="chip chip-grey">No date</span>;
  const lbl=s==="matured"?"Past Maturity":d<=365?`${d}d left`:`${Math.round(d/30)}mo left`;
  const cls=s==="matured"||s==="urgent"?"chip-red":s==="soon"?"chip-amber":"chip-green";
  return <span className={`chip ${cls}`}>{lbl}</span>;
}
function RefiChip({status}){
  const s=status||"Not Started";
  const cls=s==="Closed"?"chip-green":s==="Not Started"?"chip-grey":["In Process","Application Submitted","Commitment Issued"].includes(s)?"chip-blue":"chip-amber";
  return <span className={`chip ${cls}`}>{s}</span>;
}

/* ─────────── AMORT ─────────── */
/* ─────────── CSV EXPORT UTIL ─────────── */
function downloadCSV(filename, headers, rows){
  const esc=v=>{const s=String(v??'');return s.includes(',')||s.includes('"')||s.includes('\n')?`"${s.replace(/"/g,'""')}"`:s;};
  const csv=[headers.map(esc).join(','),...rows.map(r=>r.map(esc).join(','))].join('\n');
  const a=document.createElement('a');
  a.href='data:text/csv;charset=utf-8,'+encodeURIComponent(csv);
  a.download=filename;a.click();
}

/* ─────────── AMORT SCHEDULE ─────────── */
function AmortSchedule({loan}){
  const [showAll,setShowAll]=useState(false);
  const amM=Math.max(1,(loan.amortYears||loan.termYears||1)*12);
  const termM=Math.max(1,(loan.termYears||1)*12);
  const mr=loan.rate/100/12;
  const pmt=loan.interestOnly?loan.origBalance*mr:calcPmt(loan.origBalance,loan.rate,amM);
  const elapsed=mosBetween(loan.origDate||TODAY_STR,TODAY_STR);

  // Build full schedule
  const allRows=[];
  let bal=loan.origBalance;
  let totalInt=0,totalPri=0;
  for(let m=1;m<=termM;m++){
    const interest=bal*mr;
    const principal=loan.interestOnly?0:Math.max(0,Math.min(pmt-interest,bal));
    const balloon=(m===termM&&!loan.interestOnly)?bal-principal:0;
    const closing=Math.max(0,bal-principal-balloon);
    totalInt+=interest;totalPri+=principal;
    const d=new Date(loan.origDate||TODAY_STR);d.setMonth(d.getMonth()+m);
    allRows.push({m,date:d.toISOString().slice(0,7),payment:interest+principal,interest,principal,balloon,balance:closing,totalInt,totalPri,isNow:m===elapsed});
    bal=closing;
    if(closing<=0)break;
  }

  const displayRows=showAll?allRows:allRows.filter(r=>r.isNow||r.m===1||r.m%12===0||r.m===allRows.length);

  const exportCSV=()=>downloadCSV(
    `amortization-${(loan.addr||'loan').replace(/\s+/g,'-')}.csv`,
    ['Month','Date','Payment','Interest','Principal','Balloon','Balance','Cumul. Interest','Cumul. Principal'],
    allRows.map(r=>[r.m,r.date,r.payment.toFixed(2),r.interest.toFixed(2),r.principal.toFixed(2),r.balloon.toFixed(2),r.balance.toFixed(2),r.totalInt.toFixed(2),r.totalPri.toFixed(2)])
  );

  const totalCost=totalInt+loan.origBalance;
  const lastRow=allRows[allRows.length-1];

  return(<div>
    {/* Summary stats */}
    <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:10,marginBottom:16}}>
      {[
        {l:'Monthly Payment',v:f$(pmt),c:''},
        {l:'Total Interest',v:f$(totalInt),c:'red'},
        {l:'Total Cost of Loan',v:f$(totalCost),c:''},
        {l:'Loan Paid Off',v:lastRow?.date?.slice(0,7)||'—',c:'green'},
      ].map((k,i)=>(
        <div key={i} style={{background:'var(--bg)',borderRadius:10,padding:'12px 14px',border:'1px solid var(--bd)'}}>
          <div style={{fontSize:9,fontWeight:700,color:'var(--t3)',textTransform:'uppercase',letterSpacing:'.06em',marginBottom:5}}>{k.l}</div>
          <div style={{fontSize:15,fontWeight:700,color:k.c==='red'?'var(--red)':k.c==='green'?'var(--green)':'var(--t1)'}}>{k.v}</div>
        </div>
      ))}
    </div>
    {/* Interest vs principal progress */}
    <div style={{marginBottom:14}}>
      <div style={{display:'flex',justifyContent:'space-between',fontSize:10,color:'var(--t3)',marginBottom:4}}>
        <span>Interest: {f$(totalInt)} ({(totalInt/totalCost*100).toFixed(0)}%)</span>
        <span>Principal: {f$(loan.origBalance)} ({(loan.origBalance/totalCost*100).toFixed(0)}%)</span>
      </div>
      <div style={{height:8,borderRadius:4,background:'var(--bd)',overflow:'hidden',display:'flex'}}>
        <div style={{width:`${totalInt/totalCost*100}%`,background:'#ef4444',opacity:.7}}/>
        <div style={{flex:1,background:'#22c55e',opacity:.7}}/>
      </div>
    </div>
    {/* Export + toggle */}
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
      <div style={{fontSize:11,color:'var(--t3)'}}>{showAll?allRows.length:displayRows.length} rows shown {!showAll?`(${allRows.length} total)`:''}</div>
      <div style={{display:'flex',gap:8}}>
        <button onClick={()=>setShowAll(s=>!s)} className="btn-light" style={{fontSize:11,padding:'5px 12px'}}>{showAll?'Show summary':'Show all months'}</button>
        <button onClick={exportCSV} className="btn-dark" style={{fontSize:11,padding:'5px 12px'}}>⬇ Export CSV</button>
      </div>
    </div>
    {/* Table */}
    <div style={{overflowX:'auto'}}>
      <table className="amort-tbl" style={{width:'100%'}}>
        <thead>
          <tr>
            <th>Mo</th><th>Date</th><th>Payment</th>
            <th style={{color:'var(--red)'}}>Interest</th>
            <th style={{color:'var(--green)'}}>Principal</th>
            <th>Balance</th>
            <th style={{color:'var(--t4)'}}>Cumul. Interest</th>
          </tr>
        </thead>
        <tbody>
          {displayRows.map(r=>(
            <tr key={r.m} style={{background:r.isNow?'#fff8e1':r.m%24===0?'var(--bg)':'var(--white)',fontWeight:r.isNow?700:400}}>
              <td style={{color:r.isNow?'var(--amber)':'var(--t2)',fontSize:11}}>{r.isNow?'▶ Now':r.m}</td>
              <td style={{fontSize:11,color:'var(--t3)'}}>{r.date}</td>
              <td style={{fontWeight:600}}>{f$(r.payment)}</td>
              <td style={{color:'var(--red)'}}>{f$(r.interest)}</td>
              <td style={{color:'var(--green)'}}>{f$(r.principal)}</td>
              <td style={{fontWeight:600}}>{f$(r.balance)}</td>
              <td style={{color:'var(--t4)',fontSize:11}}>{f$(r.totalInt)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr style={{background:'var(--bg)',fontWeight:700}}>
            <td colSpan={3} style={{fontSize:11}}>TOTALS</td>
            <td style={{color:'var(--red)'}}>{f$(totalInt)}</td>
            <td style={{color:'var(--green)'}}>{f$(totalPri)}</td>
            <td></td><td></td>
          </tr>
        </tfoot>
      </table>
    </div>
  </div>);
}


/* ─────────── ACTIVITY LOG ─────────── */
function ActivityLog({log,onAdd,onDel}){
  const [txt,setTxt]=useState(""),[type,setType]=useState("call");
  const sub=()=>{if(!txt.trim())return;onAdd({id:Date.now(),type,text:txt.trim(),date:TODAY_STR});setTxt("");};
  return(<div>
    {log.length===0&&<div className="hist-empty"><div className="he-icon">📋</div><div className="he-txt">No records yet — log the first activity above</div></div>}
    {[...log].reverse().map(e=>{const at=ACT_TYPES.find(a=>a.id===e.type)||ACT_TYPES[4];return(
      <div key={e.id} className="act-entry">
        <div className="ae-ic">{at.icon}</div>
        <div style={{flex:1}}>
          <div className="ae-txt">{e.text}</div>
          <div className="ae-meta"><span>{at.label}</span><span>{fDateF(e.date)}</span>
            <button style={{background:"none",border:"none",color:"var(--t4)",cursor:"pointer",fontSize:9,padding:0}} onClick={()=>onDel(e.id)}>✕</button>
          </div>
        </div>
      </div>
    );})}
    <div className="log-form">
      <div className="lf-types">{ACT_TYPES.map(a=><button key={a.id} className={`lf-tb${type===a.id?" sel":""}`} onClick={()=>setType(a.id)}>{a.icon} {a.label}</button>)}</div>
      <div className="lf-row">
        <input className="lf-inp" placeholder="Log a call, note, or meeting…" value={txt} onChange={e=>setTxt(e.target.value)} onKeyDown={e=>e.key==="Enter"&&sub()}/>
        <button className="lf-sub" onClick={sub}>Add</button>
      </div>
    </div>
  </div>);
}

/* ─────────── PREPAYMENT / EXIT COST CALCULATOR ─────────── */
const TREASURY_RATE=4.35; // approximate 10yr Treasury — update as needed

function PrepayCalc({loan}){
  const el=enrich(loan);
  const bal=el.curBal;
  const moLeft=el.daysLeft!=null?Math.max(0,el.daysLeft/30):0;
  const prepayRaw=(loan.prepay||"").toLowerCase();

  // Detect prepay type from field
  const isYM=prepayRaw.includes("yield")||prepayRaw.includes("ym");
  const isDefeas=prepayRaw.includes("defeas");
  const isStepdown=!!prepayRaw.match(/\d[\-–]\d/);
  const isFixedPct=!!prepayRaw.match(/^\d+(\.\d+)?%/);
  const isMakeWhole=prepayRaw.includes("make whole")||prepayRaw.includes("makewhole");
  const isNone=prepayRaw==="none"||prepayRaw===""||prepayRaw==="n/a";

  // Yield Maintenance calc
  const [mktRate,setMktRate]=useState(String(TREASURY_RATE));
  const loanRate=loan.rate/100/12;
  const treasuryRate=parseFloat(mktRate)/100/12;
  const ymMonths=Math.round(moLeft);
  const ymPV=ymMonths>0?Array.from({length:ymMonths},(_,i)=>bal*Math.max(0,loanRate-treasuryRate)/Math.pow(1+treasuryRate,i+1)).reduce((a,b)=>a+b,0):0;
  const ymTotal=Math.max(0,ymPV);

  // Defeasance estimate (Treasury bond portfolio)
  const defeasRate=parseFloat(mktRate)/100;
  const defeasCost=ymMonths>0?Math.max(0,bal-(bal/(Math.pow(1+defeasRate/12,ymMonths)))*ymMonths*defeasRate/12):0;
  const defeasAlt=bal*0.03; // rough 3% rule of thumb

  // Step-down parse (e.g. "5-4-3-2-1" = 5% yr1, 4% yr2, etc.)
  const parseStepdown=()=>{
    const nums=prepayRaw.match(/\d+/g);
    if(!nums)return null;
    const steps=nums.map(Number);
    const yearsElapsed=Math.floor(mosBetween(loan.origDate||TODAY_STR,TODAY_STR)/12);
    const pct=(steps[yearsElapsed]||0)/100;
    return{pct,cost:bal*pct,yearsElapsed,steps};
  };
  const stepInfo=isStepdown?parseStepdown():null;

  // Fixed % parse
  const fixedPct=isFixedPct?parseFloat(prepayRaw)/100:null;

  // Make-whole (similar to YM but uses full term)
  const makeWholeCost=isMakeWhole?ymTotal*1.15:null; // ~15% premium over YM estimate

  // User-entered scenario
  const [scenPct,setScenPct]=useState("1.0");
  const scenCost=bal*(parseFloat(scenPct)||0)/100;

  const Row=({label,val,note,highlight})=>(
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",padding:"12px 0",borderBottom:"1px solid var(--bd)"}}>
      <div>
        <div style={{fontSize:13,fontWeight:600,color:"var(--t1)"}}>{label}</div>
        {note&&<div style={{fontSize:10,color:"var(--t3)",marginTop:2,maxWidth:380,lineHeight:1.5}}>{note}</div>}
      </div>
      <div style={{fontSize:18,fontWeight:700,color:highlight?"var(--red)":"var(--t1)",flexShrink:0,marginLeft:24,textAlign:"right"}}>
        {val}
        <div style={{fontSize:10,color:"var(--t3)",fontWeight:400,textAlign:"right"}}>
          {typeof val==="string"&&val.startsWith("$")?`${((parseFloat(val.replace(/[$MK,]/g,""))*1e6>bal?1:parseFloat(val.replace(/[$,MK]/g,""))*1000/bal)*100).toFixed(1)}% of balance`:""}
        </div>
      </div>
    </div>
  );

  return(<div>
    {/* Header context */}
    <div style={{background:"var(--bg)",border:"1px solid var(--bd)",borderRadius:12,padding:"14px 18px",marginBottom:20,display:"flex",gap:32,flexWrap:"wrap"}}>
      <div><div style={{fontSize:9,fontWeight:700,color:"var(--t3)",textTransform:"uppercase",letterSpacing:".07em",marginBottom:3}}>Current Balance</div><div style={{fontSize:18,fontWeight:700,color:"var(--t1)"}}>{f$(bal)}</div></div>
      <div><div style={{fontSize:9,fontWeight:700,color:"var(--t3)",textTransform:"uppercase",letterSpacing:".07em",marginBottom:3}}>Rate</div><div style={{fontSize:18,fontWeight:700,color:"var(--t1)"}}>{fPct(loan.rate)}</div></div>
      <div><div style={{fontSize:9,fontWeight:700,color:"var(--t3)",textTransform:"uppercase",letterSpacing:".07em",marginBottom:3}}>Months Remaining</div><div style={{fontSize:18,fontWeight:700,color:"var(--t1)"}}>{Math.round(moLeft)}</div></div>
      <div><div style={{fontSize:9,fontWeight:700,color:"var(--t3)",textTransform:"uppercase",letterSpacing:".07em",marginBottom:3}}>Stated Prepay Terms</div><div style={{fontSize:18,fontWeight:700,color:"var(--amber)"}}>{loan.prepay||"Not specified"}</div></div>
    </div>

    {/* Treasury rate input */}
    <div style={{background:"var(--white)",border:"1px solid var(--bd)",borderRadius:12,padding:"14px 18px",marginBottom:20,display:"flex",alignItems:"center",gap:16}}>
      <div style={{flex:1}}>
        <div style={{fontSize:12,fontWeight:600,color:"var(--t1)",marginBottom:2}}>10-Year Treasury Rate (%)</div>
        <div style={{fontSize:11,color:"var(--t3)"}}>Used for Yield Maintenance and Defeasance calculations. Update to current rate before making decisions.</div>
      </div>
      <input type="number" step="0.01" value={mktRate} onChange={e=>setMktRate(e.target.value)}
        style={{width:100,padding:"8px 12px",border:"2px solid var(--blue)",borderRadius:9,fontSize:16,fontWeight:700,color:"var(--blue)",textAlign:"center",outline:"none"}}/>
    </div>

    {/* Results */}
    <div style={{background:"var(--white)",border:"1px solid var(--bd)",borderRadius:14,padding:"6px 20px 0",marginBottom:20}}>
      <div style={{fontSize:10,fontWeight:700,color:"var(--t3)",textTransform:"uppercase",letterSpacing:".08em",padding:"12px 0 4px"}}>Exit Cost Scenarios</div>

      {(isYM||isMakeWhole)&&<Row
        label={isMakeWhole?"Make-Whole Premium (est.)":"Yield Maintenance (est.)"}
        val={f$(isMakeWhole?makeWholeCost:ymTotal)}
        note={`Spread: ${fPct(loan.rate)} loan − ${mktRate}% Treasury = ${fPct(Math.max(0,loan.rate-parseFloat(mktRate)))} over ${Math.round(moLeft)} months, discounted at Treasury rate. Get exact figure from ${loan.servicerName||"your servicer"} before acting.`}
        highlight={ymTotal>50000}
      />}

      {isDefeas&&<Row
        label="Defeasance Cost (est.)"
        val={f$(defeasAlt)}
        note={`Rough estimate ~3% of balance. True defeasance requires purchasing a Treasury bond portfolio sized to cover remaining payments. Get exact quote from Chatham Financial or Thirty Capital.`}
        highlight={defeasAlt>50000}
      />}

      {isStepdown&&stepInfo&&<Row
        label={`Step-Down Penalty — Year ${stepInfo.yearsElapsed+1}`}
        val={f$(stepInfo.cost)}
        note={`Schedule: ${stepInfo.steps.join("% → ")}% — you are in year ${stepInfo.yearsElapsed+1}, penalty is ${stepInfo.steps[stepInfo.yearsElapsed]||0}% of outstanding balance.`}
        highlight={stepInfo.cost>25000}
      />}

      {isFixedPct&&<Row
        label={`Fixed Prepayment Penalty (${prepayRaw})`}
        val={f$(bal*(fixedPct||0))}
        note={`${prepayRaw} of current outstanding balance of ${f$(bal)}.`}
        highlight
      />}

      {isNone&&<div style={{padding:"20px 0",textAlign:"center"}}>
        <div style={{fontSize:24,marginBottom:8}}>✅</div>
        <div style={{fontSize:14,fontWeight:600,color:"var(--green)"}}>No prepayment penalty recorded</div>
        <div style={{fontSize:11,color:"var(--t3)",marginTop:4}}>Confirm with your servicer before proceeding.</div>
      </div>}

      {!isYM&&!isDefeas&&!isStepdown&&!isFixedPct&&!isMakeWhole&&!isNone&&<div style={{padding:"16px 0",color:"var(--t3)",fontSize:12}}>
        Prepay terms "{loan.prepay}" not auto-recognized. Use the custom scenario below.
      </div>}

      {/* Always show custom scenario */}
      <div style={{borderTop:"1px solid var(--bd)",padding:"14px 0"}}>
        <div style={{fontSize:12,fontWeight:600,color:"var(--t2)",marginBottom:8}}>Custom Scenario — Enter penalty % of balance</div>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <input type="number" step="0.1" value={scenPct} onChange={e=>setScenPct(e.target.value)}
            style={{width:80,padding:"6px 10px",border:"1px solid var(--bd2)",borderRadius:8,fontSize:13,fontWeight:600,outline:"none"}}/>
          <span style={{fontSize:12,color:"var(--t3)"}}>% of {f$(bal)}</span>
          <span style={{fontSize:18,fontWeight:700,color:"var(--red)",marginLeft:"auto"}}>{f$(scenCost)}</span>
        </div>
      </div>
    </div>

    {/* Total exit cost breakdown */}
    <div style={{background:"var(--rbg)",border:"1px solid var(--rbd)",borderRadius:14,padding:"16px 20px"}}>
      <div style={{fontSize:12,fontWeight:700,color:"var(--t1)",marginBottom:12}}>⚠ Remember: Total Exit Cost = Prepay Penalty + Closing Costs + Legal/Title</div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10}}>
        {[
          {l:"Prepay Penalty",v:isStepdown&&stepInfo?f$(stepInfo.cost):isYM?f$(ymTotal):isDefeas?f$(defeasAlt):"See above"},
          {l:"Closing Costs (est. 1%)",v:f$(bal*0.01)},
          {l:"Legal / Title (est.)",v:f$(Math.min(50000,bal*0.003))},
        ].map((it,i)=>(
          <div key={i} style={{background:"var(--white)",borderRadius:10,padding:"10px 14px"}}>
            <div style={{fontSize:9,fontWeight:700,color:"var(--t3)",textTransform:"uppercase",letterSpacing:".06em",marginBottom:4}}>{it.l}</div>
            <div style={{fontSize:15,fontWeight:700,color:"var(--red)"}}>{it.v}</div>
          </div>
        ))}
      </div>
    </div>
  </div>);
}


function LoanDetail({raw,onBack,onSave,onEdit,onDelete}){
  const loan=enrich(raw);
  const [tab,setTab]=useState("overview");
  const [rs,setRs]=useState(raw.refiStatus||"Not Started");
  const [confirmDelete,setConfirmDelete]=useState(false);
  const dscrAlert=loan.dscr&&raw.dscrCovenant&&loan.dscr<raw.dscrCovenant;
  const mktSave=Math.max(0,loan.pmt-loan.marketPmt);

  return(<div className="detail-wrap">
    <div className="dtop">
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:12}}>
        <div><div className="d-addr">{loan.addr}</div><div className="d-ent">{loan.entity||loan.lender}</div></div>
        <div style={{display:"flex",gap:8,flexShrink:0,flexWrap:"wrap"}}>
          <button onClick={onEdit} style={{padding:"6px 14px",background:"var(--white)",border:"1px solid var(--bd2)",borderRadius:8,fontSize:12,fontWeight:600,color:"var(--t2)",cursor:"pointer"}}>✏️ Edit</button>
          {confirmDelete
            ?<div style={{display:"flex",gap:6,alignItems:"center"}}>
              <span style={{fontSize:11,color:"var(--red)",fontWeight:700}}>Delete this loan?</span>
              <button onClick={onDelete} style={{padding:"6px 12px",background:"var(--red)",border:"none",borderRadius:8,fontSize:11,fontWeight:700,color:"#fff",cursor:"pointer"}}>Confirm</button>
              <button onClick={()=>setConfirmDelete(false)} style={{padding:"6px 10px",background:"var(--white)",border:"1px solid var(--bd)",borderRadius:8,fontSize:11,color:"var(--t3)",cursor:"pointer"}}>Cancel</button>
            </div>
            :<button onClick={()=>setConfirmDelete(true)} style={{padding:"6px 14px",background:"var(--rbg)",border:"1px solid var(--rbd)",borderRadius:8,fontSize:12,fontWeight:600,color:"var(--red)",cursor:"pointer"}}>🗑 Delete</button>
          }
        </div>
      </div>
      <div className="d-chips" style={{marginTop:10}}>
        <MatChip loan={loan}/>
        <span className={`chip ${loan.loanType==="Bridge"?"chip-dark":loan.loanType==="ARM"?"chip-amber":"chip-grey"}`}>{loan.loanType}</span>
        <span className="chip chip-grey">{loan.lenderType}</span>
        <span className="chip chip-grey">{loan.interestOnly?"Interest Only":`${loan.amortYears}yr amort`}</span>
        <RefiChip status={rs}/>
      </div>
      <div className="d-meta-row">
        <div className="dm"><div className="dm-lbl">Maturity</div><div className={`dm-val${loan.status==="urgent"||loan.status==="matured"?" red":loan.status==="soon"?" amber":""}`}>{fDate(loan.maturityDate)}</div></div>
        <div className="dm"><div className="dm-lbl">Current Balance</div><div className="dm-val">{f$(loan.curBal)}</div></div>
        <div className="dm"><div className="dm-lbl">Monthly Payment</div><div className="dm-val">{f$(loan.pmt)}</div></div>
        <div className="dm"><div className="dm-lbl">Annual DS</div><div className="dm-val">{f$(loan.annualDS)}</div></div>
      </div>
    </div>

    <div style={{display:"flex",gap:2,marginBottom:12,background:"var(--white)",borderRadius:10,padding:3,border:"1px solid var(--bd)",width:"fit-content",flexWrap:"wrap"}}>
      {[["overview","Overview"],["amort","📊 Amortization"],["prepay","💰 Prepayment"],["activity",`📋 Activity (${raw.activityLog?.length||0})`],["contacts","Contacts"]].map(([id,lbl])=>(
        <button key={id} onClick={()=>setTab(id)} style={{padding:"6px 14px",borderRadius:8,border:"none",fontSize:12,fontWeight:tab===id?700:400,background:tab===id?"var(--t1)":"transparent",color:tab===id?"var(--white)":"var(--t3)",cursor:"pointer"}}>{lbl}</button>
      ))}
    </div>

    {tab==="overview"&&<>
      {dscrAlert&&<div className="warn-box">⚠ DSCR {loan.dscr?.toFixed(2)}x below covenant ({raw.dscrCovenant}x)</div>}
      {loan.capExpiring&&<div className="warn-box">⚠ Rate cap expires {fDateS(loan.capExpiry)} before loan maturity</div>}
      <div className="dpanels">
        <div className="panel"><div className="panel-hd">Loan Terms</div><div className="panel-body">
          <div className="prow"><span className="pk">Lender</span><span className="pv">{loan.lender}</span></div>
          <div className="prow"><span className="pk">Rate</span><span className={`pv${loan.rate>7?" red":loan.rate>5?" amber":" green"}`}>{fPct(loan.rate)}</span></div>
          <div className="prow"><span className="pk">Orig. Balance</span><span className="pv">{f$(loan.origBalance)}</span></div>
          <div className="prow"><span className="pk">Monthly Pmt</span><span className="pv">{f$(loan.pmt)}</span></div>
          <div className="prow"><span className="pk">Annual DS</span><span className="pv">{f$(loan.annualDS)}</span></div>
          <div className="prow"><span className="pk">Prepay</span><span className="pv" style={{color:"var(--amber)",fontWeight:600}}>{loan.prepay||"None"}</span></div>
          <div className="prow"><span className="pk">Extension</span><span className="pv">{loan.extensionOptions||"None"}</span></div>
          {!loan.interestOnly&&<><div className="pk" style={{marginTop:8,fontSize:9,fontWeight:700,letterSpacing:".06em",textTransform:"uppercase",color:"var(--t4)"}}>Principal Paid — {loan.paidPct.toFixed(1)}%</div><div className="pd-bg"><div className="pd-fill" style={{width:`${Math.min(100,loan.paidPct)}%`}}/></div></>}
        </div></div>
        <div className="panel"><div className="panel-hd">Compliance & Risk</div><div className="panel-body">
          <div className="prow"><span className="pk">Recourse</span><span className="pv">{loan.recourse?"Yes":"Non-Recourse"}</span></div>
          <div className="prow"><span className="pk">Guarantor</span><span className="pv">{loan.guarantor||"—"}</span></div>
          <div className="prow"><span className="pk">DSCR</span><span className={`pv${dscrAlert?" red":loan.dscr&&loan.dscr>1.3?" green":" amber"}`}>{loan.dscr?loan.dscr.toFixed(2)+"x":"—"}</span></div>
          <div className="prow"><span className="pk">DSCR Covenant</span><span className="pv">{raw.dscrCovenant?raw.dscrCovenant+"x":"—"}</span></div>
          <div className="prow"><span className="pk">Escrow</span><span className="pv">{loan.escrow||"None"}</span></div>
          <div className="prow"><span className="pk">Market Rate</span><span className="pv">{fPct(MKT[loan.loanType])}</span></div>
          <div className="prow"><span className="pk">Originated</span><span className="pv">{fDateS(loan.origDate)}</span></div>
        </div></div>
        <div className="panel"><div className="panel-hd">Service Vendor</div><div className="panel-body">
          <div className="prow"><span className="pk">Company</span><span className="pv">{raw.servicerName||"—"}</span></div>
          <div className="prow"><span className="pk">Phone</span><span className="pv" style={{display:"flex",alignItems:"center",gap:3}}>{raw.servicerPhone||"—"}<CopyBtn text={raw.servicerPhone}/></span></div>
          <div className="prow"><span className="pk">Email</span><span className="pv" style={{display:"flex",alignItems:"center",gap:3,fontSize:10}}>{raw.servicerEmail||"—"}<CopyBtn text={raw.servicerEmail}/></span></div>
          <div className="prow"><span className="pk">Broker</span><span className="pv">{raw.brokerName||"—"}</span></div>
          <div className="prow"><span className="pk">Broker Phone</span><span className="pv" style={{display:"flex",alignItems:"center",gap:3}}>{raw.brokerPhone||"—"}<CopyBtn text={raw.brokerPhone}/></span></div>
          <div className="prow"><span className="pk">Refi Status</span><span className="pv"><select className="refi-sel" value={rs} onChange={e=>{setRs(e.target.value);onSave(raw.id,{refiStatus:e.target.value});}}>{REFI_STAGES.map(s=><option key={s}>{s}</option>)}</select></span></div>
        </div></div>
      </div>
      {mktSave>0&&<div style={{background:"var(--gbg)",border:"1px solid var(--gbd)",borderRadius:12,padding:"13px 18px",marginBottom:12,display:"flex",alignItems:"center",gap:16}}>
        <div style={{fontSize:22,fontWeight:700,color:"var(--green)"}}>{f$(mktSave*12)}/yr</div>
        <div><div style={{fontSize:12,fontWeight:600,color:"var(--t1)"}}>Potential savings vs. today's market rate</div><div style={{fontSize:11,color:"var(--t3)"}}>{f$(mktSave)}/mo if refinanced at {fPct(MKT[loan.loanType])}</div></div>
      </div>}
      {raw.notes&&<div style={{background:"var(--white)",border:"1px solid var(--bd)",borderRadius:12,padding:"14px 18px",marginBottom:12}}>
        <div style={{fontSize:9,fontWeight:700,color:"var(--t3)",textTransform:"uppercase",letterSpacing:".07em",marginBottom:6}}>Notes</div>
        <div style={{fontSize:12,color:"var(--t2)",lineHeight:1.7,whiteSpace:"pre-wrap"}}>{raw.notes}</div>
      </div>}
    </>}

    {tab==="amort"&&<div style={{background:"var(--white)",border:"1px solid var(--bd)",borderRadius:14,padding:20}}><AmortSchedule loan={raw}/></div>}
    {tab==="prepay"&&<div style={{background:"var(--white)",border:"1px solid var(--bd)",borderRadius:14,padding:20}}><PrepayCalc loan={raw}/></div>}
    {tab==="activity"&&<div className="hist-card">
      <div className="hist-hd"><div className="hist-title">Activity History</div><div className="hist-ct">{raw.activityLog?.length||0} records</div></div>
      <ActivityLog log={raw.activityLog||[]} onAdd={e=>onSave(raw.id,{actAdd:e})} onDel={id=>onSave(raw.id,{actDel:id})}/>
    </div>}
    {tab==="contacts"&&<div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
      {[{role:"Servicer",name:raw.servicerName,phone:raw.servicerPhone,email:raw.servicerEmail},{role:"Broker / Arranger",name:raw.brokerName,phone:raw.brokerPhone}].map((c,i)=>(
        <div key={i} style={{background:"var(--white)",border:"1px solid var(--bd)",borderRadius:14,padding:"16px 18px"}}>
          <div style={{fontSize:9,fontWeight:700,color:"var(--t3)",textTransform:"uppercase",letterSpacing:".07em",marginBottom:8}}>{c.role}</div>
          <div style={{fontSize:14,fontWeight:700,color:"var(--t1)",marginBottom:6}}>{c.name||"—"}</div>
          {c.phone&&<div style={{fontSize:11,color:"var(--t3)",display:"flex",alignItems:"center",gap:4,marginBottom:3}}>{c.phone}<CopyBtn text={c.phone}/></div>}
          {c.email&&<div style={{fontSize:11,color:"var(--t3)",display:"flex",alignItems:"center",gap:4}}>{c.email}<CopyBtn text={c.email}/></div>}
        </div>
      ))}
    </div>}
  </div>);
}

/* ─────────── REFI CALCULATOR ─────────── */
function RefiCalc({loans}){
  const en=useMemo(()=>loans.map(enrich),[loans]);
  const [selId,setSelId]=useState(String(loans[0]?.id||""));
  const sel=en.find(l=>String(l.id)===selId);
  const cb=sel?.curBal||0, origBal=sel?.origBalance||0, cp=sel?.pmt||0;
  const annualDS=cp*12;

  // Lender quotes — blank by default
  const blankQ=()=>({name:"",rate:"",amort:"",term:"",costs:"",notes:""});
  const [quotes,setQuotes]=useState([blankQ(),blankQ(),blankQ()]);
  const setQ=(i,k,v)=>setQuotes(q=>q.map((x,j)=>j===i?{...x,[k]:v}:x));

  const qcalc=quotes.map(q=>{
    const r=parseFloat(q.rate)||0;
    const a=parseInt(q.amort)*12||360;
    const pmt=r>0&&a>0?calcPmt(cb,r,a):null;
    const costAmt=cb*(parseFloat(q.costs)||0)/100;
    const diff=pmt!=null?cp-pmt:null;
    const be=diff&&diff>0&&costAmt>0?Math.ceil(costAmt/diff):null;
    const net10=diff!=null?diff*120-costAmt:null;
    const annNew=pmt!=null?pmt*12:null;
    return{...q,pmt,costAmt,diff,be,net10,annNew};
  });

  const filledQuotes=qcalc.filter(q=>q.pmt!=null);
  const bi=filledQuotes.length>0?qcalc.reduce((b,q,i)=>q.pmt!=null&&(qcalc[b].pmt==null||q.pmt<qcalc[b].pmt)?i:b,0):null;

  const ymEst=sel?.prepay&&sel.prepay.toLowerCase().includes("yield")&&sel.daysLeft!=null?cb*(Math.max(0,(sel.rate-(parseFloat(filledQuotes[0]?.rate)||sel.rate)))/100)*(Math.max(0,sel.daysLeft)/365)*0.7:null;

  const CARD={background:"var(--white)",border:"1px solid var(--bd)",borderRadius:12,padding:"16px 20px"};
  const ROW={display:"flex",justifyContent:"space-between",alignItems:"center",padding:"7px 0",borderBottom:"1px solid var(--bd2)"};
  const LBL={fontSize:12,color:"var(--t3)"};
  const VAL={fontSize:13,fontWeight:700,color:"var(--t1)"};

  return(<div>
    <div style={{marginBottom:20}}>
      <div style={{fontSize:22,fontWeight:700,color:"var(--t1)",marginBottom:4}}>Refinancing Calculator</div>
      <div style={{fontSize:13,color:"var(--t3)"}}>Select a property, review its current loan, then enter lender quotes to compare.</div>
    </div>

    {/* Loan selector */}
    <div style={{...CARD,marginBottom:20}}>
      <div style={{fontSize:11,fontWeight:700,color:"var(--t3)",textTransform:"uppercase",letterSpacing:".07em",marginBottom:8}}>Select Property</div>
      <select style={{width:"100%",padding:"9px 12px",borderRadius:8,border:"1px solid var(--bd)",background:"var(--bg)",color:"var(--t1)",fontSize:13,fontWeight:600}}
        value={selId} onChange={e=>setSelId(e.target.value)}>
        {loans.map(l=><option key={l.id} value={String(l.id)}>{l.addr} — {l.lender}</option>)}
      </select>
    </div>

    {sel&&<>
    {/* ── CURRENT LOAN DETAILS ── */}
    <div style={{fontSize:13,fontWeight:700,color:"var(--t1)",marginBottom:10,textTransform:"uppercase",letterSpacing:".05em"}}>📋 Current Loan — {sel.addr}</div>
    <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12,marginBottom:24}}>
      {[
        ["Original Loan Amount",  f$(origBal),       ""],
        ["Current Balance",       f$(cb),             "estimated"],
        ["Interest Rate",         fPct(sel.rate),     sel.loanType||""],
        ["Monthly Payment",       f$(cp),             "per month"],
        ["Annual Debt Service",   f$(annualDS),       "per year"],
        ["Maturity Date",         fDateS(sel.maturityDate)||"—", sel.daysLeft!=null?`${sel.daysLeft} days left`:""],
        ["Close Date",            sel.origDate?new Date(sel.origDate).toLocaleDateString("en-US",{month:"short",year:"numeric"}):"—", ""],
        ["Term",                  sel.termMonths?`${sel.termMonths} months`:(sel.termYears?`${sel.termYears} years`:"—"), ""],
        ["Prepay Penalty",        sel.prepay||"None", "PPP"],
        ["IO Period",             sel.ioPeriodMonths?`${sel.ioPeriodMonths} months`:"N/A", ""],
        ["Lender",                sel.lender,         "current lender"],
        ["Refi Status",           sel.refiStatus||"Not Started", ""],
      ].map(([lbl,val,sub],i)=>(
        <div key={i} style={{...CARD,padding:"14px 16px"}}>
          <div style={{fontSize:9,fontWeight:700,color:"var(--t3)",textTransform:"uppercase",letterSpacing:".08em",marginBottom:6}}>{lbl}</div>
          <div style={{fontSize:18,fontWeight:800,color:"var(--t1)",lineHeight:1.1}}>{val}</div>
          {sub&&<div style={{fontSize:10,color:"var(--t3)",marginTop:3}}>{sub}</div>}
        </div>
      ))}
    </div>

    {/* Exit penalty warning */}
    {ymEst!=null&&<div style={{background:"#fffbeb",border:"1px solid #fde68a",borderRadius:10,padding:"12px 16px",marginBottom:20,fontSize:13}}>
      <strong style={{color:"#92400e"}}>⚠️ Yield Maintenance Penalty:</strong>
      <span style={{color:"#78350f",marginLeft:8}}>Est. {f$(ymEst)} — get exact figure from servicer before proceeding</span>
    </div>}

    {/* ── LENDER QUOTES ── */}
    <div style={{fontSize:13,fontWeight:700,color:"var(--t1)",marginBottom:6,textTransform:"uppercase",letterSpacing:".05em"}}>💬 Potential Lender Quotes</div>
    <div style={{fontSize:12,color:"var(--t3)",marginBottom:14}}>Enter quotes from lenders below. Leave blank if not yet received. Best deal highlights automatically.</div>
    <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:14,marginBottom:24}}>
      {qcalc.map((q,i)=>{
        const isBest=i===bi&&q.pmt!=null;
        return(
          <div key={i} style={{...CARD,border:`2px solid ${isBest?"var(--green)":"var(--bd)"}`,position:"relative"}}>
            {isBest&&<div style={{position:"absolute",top:-10,left:16,background:"var(--green)",color:"#fff",fontSize:9,fontWeight:800,padding:"2px 10px",borderRadius:20,letterSpacing:".06em"}}>BEST DEAL</div>}
            {/* Lender name */}
            <input placeholder="Lender name" value={q.name} onChange={e=>setQ(i,"name",e.target.value)}
              style={{width:"100%",border:"none",borderBottom:"2px solid var(--bd2)",background:"transparent",fontSize:14,fontWeight:700,color:"var(--t1)",padding:"4px 0",marginBottom:14,outline:"none"}}/>
            {/* Input fields */}
            {[
              ["Rate (%)",         "rate",  "0.001","e.g. 6.250"],
              ["Amortization (yr)","amort", "1",    "e.g. 30"],
              ["Loan Term (yr)",   "term",  "1",    "e.g. 7"],
              ["Closing Costs (%)", "costs","0.1",  "e.g. 1.0"],
            ].map(([lbl,key,step,ph])=>(
              <div key={key} style={{marginBottom:10}}>
                <div style={{fontSize:10,color:"var(--t3)",fontWeight:600,marginBottom:3}}>{lbl}</div>
                <input type="number" step={step} placeholder={ph} value={q[key]} onChange={e=>setQ(i,key,e.target.value)}
                  style={{width:"100%",padding:"8px 10px",borderRadius:7,border:"1px solid var(--bd)",background:"var(--bg)",color:"var(--t1)",fontSize:13,fontWeight:600,outline:"none"}}/>
              </div>
            ))}
            <input placeholder="Notes (optional)" value={q.notes} onChange={e=>setQ(i,"notes",e.target.value)}
              style={{width:"100%",padding:"6px 10px",borderRadius:7,border:"1px solid var(--bd)",background:"var(--bg)",color:"var(--t3)",fontSize:11,outline:"none",marginBottom:12}}/>
            {/* Results — only show if rate entered */}
            {q.pmt!=null&&<>
              <div style={{borderTop:"2px solid var(--bd2)",paddingTop:12,marginTop:4}}>
                <div style={{fontSize:10,fontWeight:700,color:"var(--t3)",textTransform:"uppercase",letterSpacing:".06em",marginBottom:8}}>Projected Outcome</div>
                {[
                  ["New Monthly Pmt",   f$(q.pmt),                    q.diff>0?"green":q.diff<0?"red":""],
                  ["vs. Current",       `${q.diff>=0?"+":""}${f$(q.diff)}/mo`, q.diff>=0?"green":"red"],
                  ["Annual DS",         f$(q.annNew),                 ""],
                  ["Annual Savings",    f$(Math.abs(q.diff*12)),      q.diff>0?"green":q.diff<0?"red":""],
                  ["Closing Costs",     f$(q.costAmt),                "amber"],
                  ["Breakeven",         q.be?`${q.be} months`:(q.costAmt===0?"Immediate":"N/A"), q.be&&q.be<24?"green":q.be&&q.be<48?"amber":""],
                  ["10-yr Net Savings", q.net10!=null?`${q.net10>=0?"":"-"}${f$(Math.abs(q.net10))}`:"—", q.net10!=null&&q.net10>0?"green":"red"],
                ].map(([lbl,val,cls])=>(
                  <div key={lbl} style={{...ROW}}>
                    <span style={LBL}>{lbl}</span>
                    <span style={{...VAL,color:cls==="green"?"var(--green)":cls==="red"?"var(--red)":cls==="amber"?"var(--amber)":"var(--t1)"}}>{val}</span>
                  </div>
                ))}
              </div>
            </>}
            {q.pmt==null&&<div style={{textAlign:"center",padding:"20px 0",color:"var(--t4)",fontSize:11}}>Enter rate + amortization<br/>to see projections</div>}
          </div>
        );
      })}
    </div>

    {/* ── COMPARISON SUMMARY — only if 2+ quotes filled ── */}
    {filledQuotes.length>=2&&<>
      <div style={{fontSize:13,fontWeight:700,color:"var(--t1)",marginBottom:10,textTransform:"uppercase",letterSpacing:".05em"}}>📊 Side-by-Side Comparison</div>
      <div style={{...CARD,marginBottom:24,overflowX:"auto"}}>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
          <thead>
            <tr>
              <th style={{padding:"8px 12px",textAlign:"left",fontSize:10,color:"var(--t3)",fontWeight:700,textTransform:"uppercase",borderBottom:"2px solid var(--bd)"}}>Metric</th>
              <th style={{padding:"8px 12px",textAlign:"center",fontSize:10,color:"var(--t3)",fontWeight:700,textTransform:"uppercase",borderBottom:"2px solid var(--bd)"}}>Current Loan</th>
              {qcalc.filter(q=>q.pmt!=null).map((q,i)=>(
                <th key={i} style={{padding:"8px 12px",textAlign:"center",fontSize:10,fontWeight:700,textTransform:"uppercase",borderBottom:"2px solid var(--bd)",color:i===bi?"var(--green)":"var(--t3)"}}>{q.name||`Quote ${i+1}`}{i===bi?" ⭐":""}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[
              ["Rate",          fPct(sel.rate),    qcalc.filter(q=>q.pmt!=null).map(q=>fPct(parseFloat(q.rate)))],
              ["Monthly Pmt",   f$(cp),            qcalc.filter(q=>q.pmt!=null).map(q=>f$(q.pmt))],
              ["Annual DS",     f$(annualDS),      qcalc.filter(q=>q.pmt!=null).map(q=>f$(q.annNew))],
              ["Monthly Δ",     "—",               qcalc.filter(q=>q.pmt!=null).map(q=>`${q.diff>=0?"+":""}${f$(q.diff)}`)],
              ["Closing Costs", "—",               qcalc.filter(q=>q.pmt!=null).map(q=>f$(q.costAmt))],
              ["Breakeven",     "—",               qcalc.filter(q=>q.pmt!=null).map(q=>q.be?`${q.be} mo`:"N/A")],
            ].map(([lbl,cur,vals])=>(
              <tr key={lbl} style={{borderBottom:"1px solid var(--bd2)"}}>
                <td style={{padding:"9px 12px",color:"var(--t3)",fontWeight:600}}>{lbl}</td>
                <td style={{padding:"9px 12px",textAlign:"center",fontWeight:700,color:"var(--t1)"}}>{cur}</td>
                {vals.map((v,i)=>(
                  <td key={i} style={{padding:"9px 12px",textAlign:"center",fontWeight:700,color:i===bi?"var(--green)":"var(--t1)"}}>{v}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>}
    </>}
    {!sel&&<div style={{textAlign:"center",padding:"60px",color:"var(--t3)"}}>Select a property above to begin</div>}
  </div>);
}

/* ─────────── ADD / EDIT LOAN MODAL ─────────── */
function LoanModal({onSave,onClose,initial}){
  const isEdit=!!initial;
  const blank={addr:"",entity:"",lender:"",lenderType:"Regional Bank",loanType:"Fixed",origBalance:"",rate:"",termYears:"",origDate:"",maturityDate:"",amortYears:"",prepay:"",recourse:true,guarantor:"",escrow:"",extensionOptions:"",refiStatus:"Not Started",servicerName:"",servicerPhone:"",servicerEmail:"",brokerName:"",brokerPhone:"",notes:"",activityLog:[],annualNOI:"",dscrCovenant:"",capProvider:"",capRate:"",capExpiry:""};
  const [f,setF]=useState(isEdit?{...blank,...initial,origBalance:String(initial.origBalance||""),rate:String(initial.rate||""),termYears:String(initial.termYears||""),amortYears:String(initial.amortYears||""),annualNOI:String(initial.annualNOI||""),dscrCovenant:String(initial.dscrCovenant||""),capRate:String(initial.capRate||"")}:blank);
  const s=(k,v)=>setF(p=>({...p,[k]:v}));
  const isIO=f.loanType==="IO"||f.loanType==="Bridge";
  const [section,setSection]=useState("property");
  const sections=[["property","🏠 Property"],["terms","📋 Loan Terms"],["contacts","📞 Contacts"],["financials","📊 Financials"]];

  const save=()=>{
    if(!f.addr||!f.lender||!f.origBalance||!f.rate||!f.maturityDate){alert("Required: Address, Lender, Balance, Rate, Maturity Date");return;}
    const parsed={...f,interestOnly:isIO,origBalance:parseFloat(f.origBalance)||0,rate:parseFloat(f.rate)||0,termYears:parseInt(f.termYears)||1,amortYears:parseInt(f.amortYears)||0,annualNOI:parseFloat(f.annualNOI)||null,dscrCovenant:parseFloat(f.dscrCovenant)||null,capRate:parseFloat(f.capRate)||null};
    if(isEdit) onSave(initial.id,parsed);
    else onSave({...parsed,id:Date.now(),activityLog:[]});
  };

  const Field=({label,k,type="text",opts,placeholder,req})=>(
    <div className="fg">
      <div className="flbl">{label}{req&&<span style={{color:"var(--red)",marginLeft:2}}>*</span>}</div>
      {opts?<select className="finp" value={f[k]} onChange={e=>s(k,e.target.value)}>{opts.map(o=><option key={o.v||o} value={o.v||o}>{o.l||o}</option>)}</select>
           :<input className="finp" type={type} step={type==="number"?"any":undefined} placeholder={placeholder} value={f[k]||""} onChange={e=>s(k,type==="number"?e.target.value:e.target.value)}/>}
    </div>
  );

  return(<div className="ov-modal" onClick={e=>e.target===e.currentTarget&&onClose()}>
    <div className="ov-mbox" style={{maxWidth:680}}>
      <div className="ov-mhd">
        <div className="ov-mtitle">{isEdit?`✏️ Edit — ${initial.addr}`:"+ Add New Loan"}</div>
        <button className="ov-mclose" onClick={onClose}>✕</button>
      </div>

      {/* Section tabs */}
      <div style={{display:"flex",gap:2,padding:"10px 20px 0",borderBottom:"1px solid var(--bd)",background:"var(--bg)"}}>
        {sections.map(([id,lbl])=>(
          <button key={id} onClick={()=>setSection(id)} style={{padding:"7px 14px",border:"none",borderBottom:`2px solid ${section===id?"var(--t1)":"transparent"}`,background:"transparent",fontSize:12,fontWeight:section===id?700:400,color:section===id?"var(--t1)":"var(--t3)",cursor:"pointer",marginBottom:-1}}>{lbl}</button>
        ))}
      </div>

      <div className="ov-mbody">
        {section==="property"&&<>
          <div className="fg-2">
            <Field label="Street Address" k="addr" req placeholder="160 Parkside Avenue"/>
            <Field label="Legal Entity" k="entity" placeholder="M&M Parkside LLC"/>
          </div>
        </>}

        {section==="terms"&&<>
          <div className="fg-2">
            <Field label="Lender" k="lender" req placeholder="Flagstar Bank"/>
            <Field label="Lender Type" k="lenderType" opts={["Agency","Regional Bank","National Bank","Life Company","Bridge","Special Servicer","Other"]}/>
            <Field label="Loan Type" k="loanType" opts={[{v:"Fixed",l:"Fixed Rate"},{v:"ARM",l:"ARM"},{v:"IO",l:"Interest Only"},{v:"Bridge",l:"Bridge"},{v:"SOFR",l:"SOFR"}]}/>
            <Field label="Interest Rate (%)" k="rate" type="number" req placeholder="5.25"/>
            <Field label="Original Balance ($)" k="origBalance" type="number" req placeholder="5000000"/>
            <Field label="Term (Years)" k="termYears" type="number" placeholder="10"/>
            {!isIO&&<Field label="Amortization (Years)" k="amortYears" type="number" placeholder="30"/>}
            <Field label="Origination Date" k="origDate" type="date"/>
            <Field label="Maturity Date" k="maturityDate" type="date" req/>
            <Field label="Prepay Terms" k="prepay" placeholder="e.g. YM, Defeasance, 5-4-3-2-1, 1%"/>
            <Field label="Recourse" k="recourse" opts={[{v:"true",l:"Recourse"},{v:"false",l:"Non-Recourse"}]}/>
            <Field label="Guarantor" k="guarantor" placeholder="Owner personal guarantee"/>
            <Field label="Escrow" k="escrow" placeholder="Tax & Insurance"/>
            <Field label="Extension Options" k="extensionOptions" placeholder="1×1yr at lender discretion"/>
            <Field label="Refi Status" k="refiStatus" opts={REFI_STAGES}/>
          </div>
        </>}

        {section==="contacts"&&<>
          <div className="fg-2">
            <Field label="Servicer Name" k="servicerName" placeholder="Arbor Realty"/>
            <Field label="Servicer Phone" k="servicerPhone" placeholder="800-555-0100"/>
            <Field label="Servicer Email" k="servicerEmail" placeholder="servicing@lender.com"/>
            <Field label="Broker / Arranger" k="brokerName" placeholder="Eastern Union"/>
            <Field label="Broker Phone" k="brokerPhone" placeholder="212-555-0100"/>
          </div>
        </>}

        {section==="financials"&&<>
          <div className="fg-2">
            <Field label="Annual NOI ($)" k="annualNOI" type="number" placeholder="480000"/>
            <Field label="DSCR Covenant" k="dscrCovenant" type="number" placeholder="1.20"/>
            <Field label="Cap Provider" k="capProvider" placeholder="SMBC"/>
            <Field label="Cap Strike Rate (%)" k="capRate" type="number" placeholder="7.50"/>
            <Field label="Cap Expiry Date" k="capExpiry" type="date"/>
          </div>
          <Field label="Notes" k="notes"/>
          <textarea className="notes-ta" rows={4} placeholder="Key notes, action items, special terms, watch items…" value={f.notes||""} onChange={e=>s("notes",e.target.value)}/>
        </>}

        <div className="mfooter" style={{marginTop:20}}>
          <div style={{display:"flex",gap:8}}>
            {sections.map(([id],i)=>i>0&&<button key={id} className="btn-light" style={{fontSize:11}} onClick={()=>setSection(sections[i-1][0])}>← {sections[i-1][1].split(" ")[1]}</button>).filter(Boolean)[sections.findIndex(s=>s[0]===section)-1]||<div/>}
          </div>
          <div style={{display:"flex",gap:8}}>
            <button className="btn-light" onClick={onClose}>Cancel</button>
            {sections.findIndex(s=>s[0]===section)<sections.length-1
              ?<button className="btn-dark" onClick={()=>setSection(sections[sections.findIndex(s=>s[0]===section)+1][0])}>Next →</button>
              :<button className="btn-dark" onClick={save}>{isEdit?"💾 Save Changes":"✓ Add Loan"}</button>
            }
          </div>
        </div>
      </div>
    </div>
  </div>);
}



/* ─────────── PIE CHART ─────────── */
function PieChart({slices,size=160,title,legend=true}){
  const total=slices.reduce((s,x)=>s+x.val,0);
  if(total===0)return null;
  let cum=0;
  const TAU=2*Math.PI;
  const cx=size/2,cy=size/2,r=size/2-2,ri=r*0.52;
  const [hov,setHov]=useState(null);
  const paths=slices.map((sl,i)=>{
    const start=cum/total*TAU-TAU/4;
    cum+=sl.val;
    const end=cum/total*TAU-TAU/4;
    const gap=0.018;
    const s=start+gap,e=end-gap;
    if(e<=s)return null;
    const x1=cx+r*Math.cos(s),y1=cy+r*Math.sin(s);
    const x2=cx+r*Math.cos(e),y2=cy+r*Math.sin(e);
    const xi1=cx+ri*Math.cos(s),yi1=cy+ri*Math.sin(s);
    const xi2=cx+ri*Math.cos(e),yi2=cy+ri*Math.sin(e);
    const big=(e-s)>Math.PI?1:0;
    const scale=hov===i?1.04:1;
    return(
      <g key={i} style={{cursor:"pointer",transform:`scale(${scale})`,transformOrigin:`${cx}px ${cy}px`,transition:"transform .15s"}}
        onMouseEnter={()=>setHov(i)} onMouseLeave={()=>setHov(null)}>
        <path d={`M${xi1} ${yi1} L${x1} ${y1} A${r} ${r} 0 ${big} 1 ${x2} ${y2} L${xi2} ${yi2} A${ri} ${ri} 0 ${big} 0 ${xi1} ${yi1} Z`}
          fill={sl.color} opacity={hov===null||hov===i?1:0.6}/>
      </g>
    );
  });
  const hovSlice=hov!=null?slices[hov]:null;
  return(
    <div style={{display:"flex",flexDirection:"column",alignItems:"center"}}>
      {title&&<div style={{fontSize:11,fontWeight:700,color:"var(--t3)",letterSpacing:".06em",textTransform:"uppercase",marginBottom:10,textAlign:"center"}}>{title}</div>}
      <div style={{position:"relative",width:size,height:size,flexShrink:0}}>
        <svg width={size} height={size}>{paths}</svg>
        <div style={{position:"absolute",inset:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",pointerEvents:"none",padding:"20%",textAlign:"center"}}>
          {hovSlice
            ?<><div style={{fontSize:10,fontWeight:700,color:hovSlice.color,lineHeight:1.2}}>{hovSlice.label}</div>
               <div style={{fontSize:13,fontWeight:800,color:"var(--t1)",marginTop:2}}>{hovSlice.val>=1e6?`$${(hovSlice.val/1e6).toFixed(1)}M`:hovSlice.val>=1e3?`$${(hovSlice.val/1e3).toFixed(0)}K`:`$${Math.round(hovSlice.val).toLocaleString()}`}</div>
               <div style={{fontSize:9,color:"var(--t3)",marginTop:1}}>{(hovSlice.val/total*100).toFixed(1)}%</div></>
            :<><div style={{fontSize:9,color:"var(--t3)"}}>TOTAL</div>
               <div style={{fontSize:13,fontWeight:800,color:"var(--t1)"}}>{total>=1e6?`$${(total/1e6).toFixed(1)}M`:total>=1e3?`$${(total/1e3).toFixed(0)}K`:`$${Math.round(total).toLocaleString()}`}</div></>
          }
        </div>
      </div>
      {legend&&<div style={{marginTop:12,width:"100%"}}>
        {slices.map((sl,i)=>(
          <div key={i} style={{display:"flex",alignItems:"center",gap:6,marginBottom:4,cursor:"pointer",opacity:hov===null||hov===i?1:0.5,transition:"opacity .15s"}}
            onMouseEnter={()=>setHov(i)} onMouseLeave={()=>setHov(null)}>
            <div style={{width:8,height:8,borderRadius:2,background:sl.color,flexShrink:0}}/>
            <div style={{fontSize:10,color:"var(--t2)",flex:1,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{sl.label}</div>
            <div style={{fontSize:10,fontWeight:600,color:"var(--t3)",flexShrink:0}}>{(sl.val/total*100).toFixed(0)}%</div>
          </div>
        ))}
      </div>}
    </div>
  );
}

/* ─────────── OVERVIEW ─────────── */
function Overview({loans,onSelect,onAdd,dbStatus,dbError}){
  const [ovTab,setOvTab]=useState("loans"); // loans | actions
  const en=useMemo(()=>loans.map(enrich),[loans]);

  // ── KPIs ────────────────────────────────────────────────────────────────────
  const tb        = loans.reduce((s,l)=>s+(l.currentBalance||l.origBalance||0),0);
  const origTotal = loans.reduce((s,l)=>s+(l.origBalance||0),0);
  const wac       = en.reduce((s,l)=>s+l.rate*(l.currentBalance||l.origBalance||0),0)/Math.max(1,tb);
  const monthlyDS = en.reduce((s,l)=>s+(isNaN(l.pmt)?0:l.pmt),0);
  const annualDS  = monthlyDS*12;
  const urg       = en.filter(l=>l.status==="urgent"||l.status==="matured");
  const matured   = en.filter(l=>l.status==="matured");
  const inRefi    = en.filter(l=>l.refiStatus&&l.refiStatus!=="Not Started"&&l.refiStatus!=="Closed");
  const ioLoans   = en.filter(l=>l.interestOnly||l.loanType==="IO");
  const ioDebt    = ioLoans.reduce((s,l)=>s+(l.currentBalance||l.origBalance||0),0);
  const fixedLoans= en.filter(l=>!l.interestOnly&&l.loanType!=="IO"&&l.loanType!=="ARM");
  const avgLoan   = loans.length>0?tb/loans.length:0;
  const payingDown= origTotal>0?((origTotal-tb)/origTotal*100):0;

  // Lender concentration — top lender by balance
  const byLender={};
  loans.forEach(l=>{const k=l.lender||"Unknown";byLender[k]=(byLender[k]||0)+(l.currentBalance||l.origBalance||0);});
  const topLender=Object.entries(byLender).sort((a,b)=>b[1]-a[1])[0]||["—",0];
  const topLenderPct=tb>0?(topLender[1]/tb*100):0;

  // Maturities by year
  const byYear={};
  en.forEach(l=>{
    if(!l.maturityDate)return;
    const y=new Date(l.maturityDate).getFullYear();
    if(isNaN(y))return;
    if(!byYear[y])byYear[y]={count:0,bal:0,urgent:0,loans:[]};
    byYear[y].count++;
    byYear[y].bal+=(l.currentBalance||l.origBalance||0);
    if(l.status==="urgent"||l.status==="matured")byYear[y].urgent++;
    byYear[y].loans.push(l);
  });
  const matByYear=Object.entries(byYear).sort((a,b)=>Number(a[0])-Number(b[0]));

  // Alerts
  const alerts=[];
  en.filter(l=>l.status==="matured").forEach(l=>alerts.push({cls:"al-red",ic:"🔴",hl:`${l.addr} — PAST MATURITY`,detail:`${f$(l.currentBalance||l.curBal)} · ${l.lender} · ${l.daysLeft!=null?Math.abs(l.daysLeft)+" days overdue":""}`,action:"Contact lender immediately",id:l.id}));
  en.filter(l=>l.status==="urgent").forEach(l=>alerts.push({cls:"al-red",ic:"⚠",hl:`${l.addr} — matures ${fDateS(l.maturityDate)}`,detail:`${f$(l.currentBalance||l.curBal)} · ${l.lender} · ${l.daysLeft!=null?l.daysLeft+" days remaining":""}`,action:"Begin refinancing now",id:l.id}));
  en.filter(l=>l.dscr&&l.dscrCovenant&&l.dscr<l.dscrCovenant).forEach(l=>alerts.push({cls:"al-red",ic:"📊",hl:`${l.addr} — DSCR below covenant (${l.dscr?.toFixed(2)}x vs ${l.dscrCovenant}x)`,detail:l.lender,action:"Address NOI shortfall or request waiver",id:l.id}));
  en.filter(l=>l.capExpiring).forEach(l=>alerts.push({cls:"al-amber",ic:"📉",hl:`${l.addr} — rate cap expires ${fDateS(l.capExpiry)}`,detail:"Cap expires before loan maturity",action:"Purchase new cap or begin refi",id:l.id}));
  en.filter(l=>l.status==="soon").forEach(l=>alerts.push({cls:"al-amber",ic:"◎",hl:`${l.addr} — matures ${fDateS(l.maturityDate)}`,detail:l.daysLeft!=null?`${Math.round(l.daysLeft/30)} months away`:"",action:"Begin lender conversations",id:l.id}));

  const SC=(label,val,sub,cls="")=>(
    <div className="scard">
      <div className="sc-lbl">{label}</div>
      <div className={`sc-val${cls?" "+cls:""}`}>{val}</div>
      {sub&&<div className="sc-sub">{sub}</div>}
    </div>
  );

  // ── Chart data ─────────────────────────────────────────────────────────────
  // 1. IO vs Amortizing vs Bridge
  const ioAmt   = loans.filter(l=>l.loanType==="IO"||l.interestOnly).reduce((s,l)=>s+(l.currentBalance||l.origBalance||0),0);
  const bridgeAmt= loans.filter(l=>l.loanType==="Bridge").reduce((s,l)=>s+(l.currentBalance||l.origBalance||0),0);
  const amorAmt = tb - ioAmt - bridgeAmt;
  const ioSlices=[
    {label:"Interest Only",val:ioAmt,color:"#f59e0b"},
    {label:"Amortizing",val:Math.max(0,amorAmt),color:"#10b981"},
    {label:"Bridge",val:bridgeAmt,color:"#6366f1"},
  ].filter(s=>s.val>0);

  // 2. Rate Tiers
  const rateTiers=[
    {label:"Sub 4%",val:0,color:"#10b981"},
    {label:"4% – 5%",val:0,color:"#34d399"},
    {label:"5% – 6%",val:0,color:"#f59e0b"},
    {label:"6%+",val:0,color:"#ef4444"},
  ];
  loans.forEach(l=>{
    const b=l.currentBalance||l.origBalance||0;
    const r=l.rate||0;
    if(r<4)rateTiers[0].val+=b;
    else if(r<5)rateTiers[1].val+=b;
    else if(r<6)rateTiers[2].val+=b;
    else rateTiers[3].val+=b;
  });
  const rateSlices=rateTiers.filter(s=>s.val>0);

  // 3. Lender concentration (top 6 + Other)
  const lenderMap={};
  loans.forEach(l=>{const k=l.lender||"Unknown";lenderMap[k]=(lenderMap[k]||0)+(l.currentBalance||l.origBalance||0);});
  const lenderColors=["#3b82f6","#8b5cf6","#f59e0b","#10b981","#ef4444","#06b6d4","#94a3b8"];
  const lenderSorted=Object.entries(lenderMap).sort((a,b)=>b[1]-a[1]);
  const top6=lenderSorted.slice(0,6);
  const otherVal=lenderSorted.slice(6).reduce((s,[,v])=>s+v,0);
  const lenderSlices=[...top6.map(([k,v],i)=>({label:k,val:v,color:lenderColors[i]})),
    ...(otherVal>0?[{label:"Other",val:otherVal,color:"#94a3b8"}]:[])];

  // 4. Maturity Buckets
  const NOW_YR=new Date().getFullYear();
  const matBuckets=[
    {label:"Past Due",val:0,color:"#dc2626"},
    {label:"2026",val:0,color:"#f97316"},
    {label:"2027",val:0,color:"#f59e0b"},
    {label:"2028",val:0,color:"#84cc16"},
    {label:"2029+",val:0,color:"#10b981"},
    {label:"No Date",val:0,color:"#94a3b8"},
  ];
  loans.forEach(l=>{
    const b=l.currentBalance||l.origBalance||0;
    if(!l.maturityDate){matBuckets[5].val+=b;return;}
    const yr=new Date(l.maturityDate).getFullYear();
    if(isNaN(yr)){matBuckets[5].val+=b;return;}
    const d=daysTo(l.maturityDate);
    if(d!=null&&d<0)matBuckets[0].val+=b;
    else if(yr<=2026)matBuckets[1].val+=b;
    else if(yr===2027)matBuckets[2].val+=b;
    else if(yr===2028)matBuckets[3].val+=b;
    else matBuckets[4].val+=b;
  });
  const matSlices=matBuckets.filter(s=>s.val>0);

  if(loans.length===0){return(<div>
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
      <div><div style={{fontSize:22,fontWeight:700,color:"var(--t1)"}}>Portfolio Overview</div><div style={{fontSize:13,color:"var(--t3)",marginTop:2}}>Brooklyn, NY · Debt Management</div></div>
    </div>
    {dbStatus==="error"&&<div style={{background:"#fef2f2",border:"1px solid #fca5a5",borderRadius:10,padding:"14px 18px",marginBottom:16,fontSize:13}}>
      <strong style={{color:"#dc2626"}}>⚠️ Database connection error:</strong>
      <div style={{color:"#991b1b",marginTop:4,fontFamily:"monospace",fontSize:12}}>{dbError}</div>
      <div style={{color:"#7f1d1d",marginTop:6}}>Go to Supabase → SQL Editor and run <strong>setup_loans_table_v2.sql</strong> then <strong>insert_loans_v2.sql</strong></div>
    </div>}
    {dbStatus==="loading"&&<div style={{background:"#eff6ff",border:"1px solid #bfdbfe",borderRadius:10,padding:"14px 18px",marginBottom:16,fontSize:13,color:"#1d4ed8"}}>⏳ Connecting to database...</div>}
    {dbStatus==="empty"&&<div style={{background:"#fffbeb",border:"1px solid #fde68a",borderRadius:10,padding:"14px 18px",marginBottom:16,fontSize:13}}>
      <strong style={{color:"#92400e"}}>📋 Database connected but no loans found.</strong>
      <div style={{color:"#78350f",marginTop:4}}>Run <strong>insert_loans_v2.sql</strong> in Supabase SQL Editor to load your 77 loans — or add them manually below.</div>
    </div>}
    <div style={{background:"var(--white)",border:"2px dashed var(--bd2)",borderRadius:20,padding:"64px 40px",textAlign:"center",marginTop:20}}>
      <div style={{fontSize:48,marginBottom:16,opacity:.2}}>🏛</div>
      <div style={{fontSize:20,fontWeight:700,color:"var(--t1)",marginBottom:8}}>No loans yet</div>
      <div style={{fontSize:13,color:"var(--t3)",lineHeight:1.7,maxWidth:400,margin:"0 auto 28px"}}>Add your first mortgage to start tracking balances, maturities, debt service, and refinancing activity across your portfolio.</div>
      <button className="btn-dark" onClick={onAdd} style={{fontSize:14,padding:"11px 28px"}}>+ Add Your First Loan</button>
    </div>
  </div>);}

  return(<div>
    {/* ── Header ── */}
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
      <div>
        <div style={{fontSize:22,fontWeight:700,color:"var(--t1)"}}>Portfolio Overview</div>
        <div style={{fontSize:13,color:"var(--t3)",marginTop:2}}>Brooklyn, NY · {loans.length} loans · {new Date().toLocaleDateString("en-US",{month:"long",year:"numeric"})}</div>
      </div>
      <button className="btn-dark" onClick={onAdd}>+ Add Loan</button>
    </div>

    {/* ── KPI Row 1 — Debt & Cash Flow ── */}
    <div style={{fontSize:11,fontWeight:700,color:"var(--t3)",letterSpacing:".08em",textTransform:"uppercase",marginBottom:8}}>Debt & Cash Flow</div>
    <div className="ov-stats" style={{gridTemplateColumns:"repeat(5,1fr)",marginBottom:14}}>
      {SC("Original Loan Total",f$(origTotal),"sum of all original loans")}
      {SC("Current Debt Total",f$(tb),"sum of current balances")}
      {SC("Monthly Debt Service",f$(monthlyDS),"est. all loans combined")}
      {SC("Annual Debt Service",f$(annualDS),"total yearly payments")}
      {SC("Avg Loan Size",f$(avgLoan),`across ${loans.length} loans`)}
    </div>

    {/* ── KPI Row 2 — Rate & Structure ── */}
    <div style={{fontSize:11,fontWeight:700,color:"var(--t3)",letterSpacing:".08em",textTransform:"uppercase",marginBottom:8}}>Rate & Structure</div>
    <div className="ov-stats" style={{gridTemplateColumns:"repeat(4,1fr)",marginBottom:14}}>
      {SC("Wtd. Avg. Rate",fPct(wac),"weighted by balance","amber")}
      {SC("IO Exposure",f$(ioDebt),`${ioLoans.length} interest-only loans`,"amber")}
      {SC("Amortizing Debt",f$(fixedLoans.reduce((s,l)=>s+(l.currentBalance||l.origBalance||0),0)),`${fixedLoans.length} fixed/amortizing loans`)}
      {SC("Principal Paid Down",`${payingDown.toFixed(1)}%`,`$${((origTotal-tb)/1e6).toFixed(1)}M from original`,"green")}
    </div>

    {/* ── KPI Row 3 — Risk ── */}
    <div style={{fontSize:11,fontWeight:700,color:"var(--t3)",letterSpacing:".08em",textTransform:"uppercase",marginBottom:8}}>Maturity Risk</div>
    <div className="ov-stats" style={{gridTemplateColumns:"repeat(4,1fr)",marginBottom:20}}>
      {SC("Past Maturity",matured.length,matured.length>0?"urgent — contact lenders":"all current","red")}
      {SC("Maturing ≤6 Months",urg.length,`$${(urg.reduce((s,l)=>s+(l.currentBalance||l.origBalance||0),0)/1e6).toFixed(1)}M at risk`,urg.length>0?"red":"")}
      {SC("Refi In Progress",inRefi.length,"loans being refinanced","blue")}
      {SC("Top Lender Concentration",topLender[0].length>12?topLender[0].slice(0,12)+"…":topLender[0],`${topLenderPct.toFixed(0)}% of portfolio`)}
    </div>

    {/* ── Charts ── */}
    <div style={{fontSize:11,fontWeight:700,color:"var(--t3)",letterSpacing:".08em",textTransform:"uppercase",marginBottom:12}}>Portfolio Composition</div>
    <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:16,marginBottom:24,background:"var(--white)",border:"1px solid var(--bd)",borderRadius:14,padding:"20px 16px"}}>
      <PieChart slices={ioSlices} title="IO vs Amortizing vs Bridge" size={160}/>
      <PieChart slices={rateSlices} title="Debt by Rate Tier" size={160}/>
      <PieChart slices={lenderSlices} title="Debt by Lender" size={160}/>
      <PieChart slices={matSlices} title="Maturity Buckets" size={160}/>
    </div>

    {/* ── Urgent Maturities (within 6 months) ── */}
    {urg.length>0&&<>
      <div style={{fontSize:13,fontWeight:700,color:"var(--t1)",marginBottom:8,display:"flex",alignItems:"center",gap:8}}>
        🔴 Urgent Maturities — Within 6 Months
        <span style={{fontSize:11,fontWeight:400,color:"var(--t3)"}}>{f$(urg.reduce((s,l)=>s+(l.currentBalance||l.origBalance||0),0))} total exposure</span>
      </div>
      <div style={{border:"1px solid #fecaca",borderRadius:10,overflow:"hidden",marginBottom:20}}>
        <table className="tbl" style={{margin:0}}>
          <thead><tr style={{background:"#fef2f2"}}>
            <th>Address</th><th>Lender</th><th>Balance</th><th>Rate</th><th>Maturity</th><th>Days Left</th><th>Refi Status</th>
          </tr></thead>
          <tbody>{[...urg].sort((a,b)=>(a.daysLeft??9999)-(b.daysLeft??9999)).map(l=>(
            <tr key={l.id} onClick={()=>onSelect(loans.find(x=>x.id===l.id))} style={{cursor:"pointer"}}>
              <td><div className="td-a">{l.addr}</div><div className="td-b">{l.lender}</div></td>
              <td><span style={{fontSize:12,color:"var(--t2)"}}>{l.lender}</span></td>
              <td><span className="td-n">{f$(l.currentBalance||l.curBal)}</span></td>
              <td><span className="td-n red">{fPct(l.rate)}</span></td>
              <td><span style={{fontSize:12}}>{fDateS(l.maturityDate)||"—"}</span></td>
              <td><span style={{fontSize:12,fontWeight:700,color:l.daysLeft<0?"#dc2626":"#d97706"}}>{l.daysLeft!=null?(l.daysLeft<0?`${Math.abs(l.daysLeft)}d overdue`:`${l.daysLeft}d left`):"—"}</span></td>
              <td><RefiChip status={l.refiStatus}/></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </>}

    {/* ── Maturities by Year ── */}
    <div style={{fontSize:13,fontWeight:700,color:"var(--t1)",marginBottom:10}}>Maturities by Year</div>
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(160px,1fr))",gap:8,marginBottom:20}}>
      {matByYear.map(([yr,d])=>{
        const isUrgent=Number(yr)<=2026;
        const isSoon=Number(yr)===2027;
        const bg=isUrgent?"#fef2f2":isSoon?"#fffbeb":"var(--white)";
        const border=isUrgent?"#fecaca":isSoon?"#fde68a":"var(--bd)";
        const valColor=isUrgent?"#dc2626":isSoon?"#d97706":"var(--t1)";
        return(
          <div key={yr} style={{background:bg,border:`1px solid ${border}`,borderRadius:10,padding:"12px 14px"}}>
            <div style={{fontSize:11,fontWeight:700,color:"var(--t3)",marginBottom:4}}>{yr}</div>
            <div style={{fontSize:20,fontWeight:800,color:valColor,marginBottom:2}}>{d.count}</div>
            <div style={{fontSize:11,color:"var(--t3)"}}>{f$(d.bal)}</div>
            {d.urgent>0&&<div style={{fontSize:10,color:"#dc2626",marginTop:4,fontWeight:600}}>⚠ {d.urgent} urgent</div>}
          </div>
        );
      })}
    </div>

    {/* ── Tabs: All Loans / Action Required ── */}
    <div style={{display:"flex",gap:0,borderBottom:"2px solid var(--bd)",marginBottom:14}}>
      {[["loans",`All Loans (${loans.length})`],["actions",`Action Required (${alerts.length})`]].map(([id,lbl])=>(
        <button key={id} onClick={()=>setOvTab(id)} style={{
          padding:"8px 18px",border:"none",borderBottom:`2px solid ${ovTab===id?"var(--t1)":"transparent"}`,
          marginBottom:-2,background:"transparent",fontSize:13,fontWeight:ovTab===id?700:400,
          color:ovTab===id?"var(--t1)":"var(--t3)",cursor:"pointer"
        }}>{lbl}</button>
      ))}
    </div>

    {/* All Loans tab */}
    {ovTab==="loans"&&<div className="tbl-wrap">
      <table className="tbl">
        <thead><tr><th>Address</th><th>Lender</th><th>Orig Balance</th><th>Cur Balance</th><th>Rate</th><th>Maturity</th><th>Refi Status</th></tr></thead>
        <tbody>{[...en].sort((a,b)=>(a.daysLeft??99999)-(b.daysLeft??99999)).map(l=>(
          <tr key={l.id} onClick={()=>onSelect(loans.find(x=>x.id===l.id))}>
            <td><div className="td-a">{l.addr}</div><div className="td-b">{l.entity||""}</div></td>
            <td><span style={{fontSize:12,color:"var(--t2)"}}>{l.lender}</span></td>
            <td><span className="td-n" style={{color:"var(--t3)"}}>{f$(l.origBalance)}</span></td>
            <td><span className="td-n">{f$(l.currentBalance||l.curBal)}</span></td>
            <td><span className={`td-n${l.rate>7?" red":l.rate>5?" amber":" green"}`}>{fPct(l.rate)}</span></td>
            <td><MatChip loan={l}/></td>
            <td><RefiChip status={l.refiStatus}/></td>
          </tr>
        ))}</tbody>
        <tfoot>
          <tr style={{background:"var(--bg)",fontWeight:700,borderTop:"2px solid var(--bd)"}}>
            <td style={{fontSize:12,fontWeight:700,color:"var(--t1)",padding:"10px 12px"}}>TOTAL ({loans.length} loans)</td>
            <td/>
            <td><span className="td-n" style={{color:"var(--t3)",fontWeight:700}}>{f$(origTotal)}</span></td>
            <td><span className="td-n" style={{fontWeight:700}}>{f$(tb)}</span></td>
            <td><span className="td-n amber" style={{fontWeight:700}}>{fPct(wac)} avg</span></td>
            <td/><td/>
          </tr>
        </tfoot>
      </table>
    </div>}

    {/* Action Required tab */}
    {ovTab==="actions"&&<div>
      {alerts.length===0
        ?<div style={{padding:"40px",textAlign:"center",color:"var(--t3)",fontSize:13}}>✅ No actions required — portfolio looks clean.</div>
        :<div className="al-list">{alerts.map((a,i)=>(
          <div key={i} className={`al-row ${a.cls}`} onClick={()=>onSelect(loans.find(l=>l.id===a.id))}>
            <div className="al-ic">{a.ic}</div>
            <div><div className="al-hl">{a.hl}</div><div className="al-detail">{a.detail}</div><div className="al-action">→ {a.action}</div></div>
          </div>
        ))}</div>
      }
    </div>}
  </div>);
}

/* ─────────── ALL LOANS ─────────── */
function AllLoans({loans,onSelect,onAdd}){
  const [search,setSearch]=useState("");
  const [filt,setFilt]=useState("all");
  const [sort,setSort]=useState({k:"daysLeft",d:1});
  const en=useMemo(()=>loans.map(enrich),[loans]);
  const rows=useMemo(()=>en.filter(l=>{
    const sf=filt==="all"||filt===l.status||filt===l.loanType||filt===l.interestOnly&&filt==="IO";
    const ss=!search||l.addr.toLowerCase().includes(search.toLowerCase())||l.lender.toLowerCase().includes(search.toLowerCase());
    return sf&&ss;
  }).sort((a,b)=>(a[sort.k]>b[sort.k]?1:-1)*sort.d),[en,filt,search,sort]);
  const th=(lbl,k)=><th onClick={()=>setSort(s=>({k,d:s.k===k?-s.d:1}))}>{lbl}{sort.k===k?sort.d===1?" ↑":" ↓":""}</th>;
  if(loans.length===0){return(<div>
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
      <div style={{fontSize:22,fontWeight:700,color:"var(--t1)"}}>All Loans</div>
      <button className="btn-dark" onClick={onAdd}>+ Add Loan</button>
    </div>
    <div style={{background:"var(--white)",border:"2px dashed var(--bd2)",borderRadius:20,padding:"64px 40px",textAlign:"center"}}>
      <div style={{fontSize:48,marginBottom:16,opacity:.2}}>📋</div>
      <div style={{fontSize:18,fontWeight:700,color:"var(--t1)",marginBottom:8}}>No loans in the portfolio yet</div>
      <div style={{fontSize:13,color:"var(--t3)",marginBottom:24}}>Use the button above to add your first mortgage.</div>
      <button className="btn-dark" onClick={onAdd} style={{fontSize:14,padding:"11px 28px"}}>+ Add Loan</button>
    </div>
  </div>);}
  const exportCSV=()=>downloadCSV("all-loans.csv",
    ["Address","Entity","Lender","Type","Orig Balance","Cur Balance","Rate","Monthly Pmt","Annual DS","Maturity Date","Days Left","Status","DSCR","Refi Status","Prepay","Recourse"],
    loans.map(enrich).map(l=>[l.addr,l.entity||"",l.lender,l.loanType,l.origBalance,l.curBal.toFixed(0),l.rate,l.pmt.toFixed(0),l.annualDS.toFixed(0),l.maturityDate,l.daysLeft,l.status,l.dscr?l.dscr.toFixed(2):"",l.refiStatus||"",l.prepay||"",l.recourse?"Yes":"No"])
  );
  return(<div>
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14}}>
      <div style={{fontSize:22,fontWeight:700,color:"var(--t1)"}}>All Loans</div>
      <div style={{display:"flex",gap:8}}>
        <button className="btn-light" onClick={exportCSV}>⬇ Export CSV</button>
        <button className="btn-dark" onClick={onAdd}>+ Add Loan</button>
      </div>
    </div>
    <div className="frow" style={{flexWrap:"wrap",gap:6}}>
      <input className="f-inp" placeholder="Search address or lender…" value={search} onChange={e=>setSearch(e.target.value)}/>
      <span style={{fontSize:10,color:"var(--t3)",alignSelf:"center",fontWeight:600,marginLeft:4}}>STATUS:</span>
      {[["all","All"],["urgent","🔴 Urgent"],["soon","🟡 Soon"],["ok","✅ Current"],["matured","⚫ Matured"]].map(([id,lbl])=>(
        <button key={id} className={`fb${filt===id?" fa":""}`} onClick={()=>setFilt(id)}>{lbl}</button>
      ))}
      <span style={{fontSize:10,color:"var(--t3)",alignSelf:"center",fontWeight:600,marginLeft:4}}>TYPE:</span>
      {[["Fixed","Fixed"],["IO","IO"],["ARM","ARM"],["Bridge","Bridge"]].map(([id,lbl])=>(
        <button key={id} className={`fb${filt===id?" fa":""}`} onClick={()=>setFilt(id)}>{lbl}</button>
      ))}
      <span style={{fontSize:10,color:"var(--t3)",alignSelf:"center",fontWeight:600,marginLeft:4}}>SORT:</span>
      {[["daysLeft","Maturity"],["curBal","Balance"],["rate","Rate"],["addr","A–Z"],["lender","Lender"]].map(([k,lbl])=>(
        <button key={k} className={`fb${sort.k===k?" fa":""}`} onClick={()=>setSort(s=>({k,d:s.k===k?-s.d:1}))}>{lbl}{sort.k===k?(sort.d===1?" ↑":" ↓"):""}</button>
      ))}
      <span className="f-ct">{rows.length} of {loans.length}</span>
    </div>
    <div className="tbl-wrap">
      <table className="tbl">
        <thead><tr>{th("Address","addr")}{th("Lender","lender")}<th>Type</th>{th("Balance","curBal")}{th("Rate","rate")}{th("Payment","pmt")}{th("DSCR","dscr")}{th("Maturity","daysLeft")}<th>Refi</th></tr></thead>
        <tbody>{rows.map(l=>(
          <tr key={l.id} onClick={()=>onSelect(loans.find(x=>x.id===l.id))}>
            <td><div className="td-a">{l.addr}</div><div className="td-b">{l.entity||l.lenderType}</div></td>
            <td><div style={{fontSize:12,color:"var(--t2)"}}>{l.lender}</div></td>
            <td><span className="chip chip-grey">{l.loanType}</span></td>
            <td><span className="td-n">{f$(l.curBal)}</span></td>
            <td><span className={`td-n${l.rate>7?" red":l.rate>5?" amber":" green"}`}>{fPct(l.rate)}</span></td>
            <td><span className="td-n">{f$(l.pmt)}/mo</span></td>
            <td><span className={`td-n${l.dscr&&l.dscrCovenant&&l.dscr<l.dscrCovenant?" red":!l.dscr?" muted":l.dscr>1.3?" green":" amber"}`}>{l.dscr?l.dscr.toFixed(2)+"x":"—"}</span></td>
            <td><MatChip loan={l}/></td>
            <td><RefiChip status={l.refiStatus}/></td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  </div>);
}

/* ─────────── MATURITY TIMELINE ─────────── */
/* ─────────── REFI PIPELINE ─────────── */
const STAGE_META={
  "Not Started":          {color:"#64748b",bg:"#f8fafc",bd:"#e2e8f0",accent:"#94a3b8",icon:"○"},
  "Exploring":            {color:"#7c3aed",bg:"#faf5ff",bd:"#ddd6fe",accent:"#7c3aed",icon:"◎"},
  "LOI Received":         {color:"#1d4ed8",bg:"#eff6ff",bd:"#bfdbfe",accent:"#3b82f6",icon:"📄"},
  "Application Submitted":{color:"#0e7490",bg:"#ecfeff",bd:"#a5f3fc",accent:"#06b6d4",icon:"📝"},
  "Appraisal Ordered":    {color:"#b45309",bg:"#fffbeb",bd:"#fde68a",accent:"#f59e0b",icon:"🏠"},
  "Commitment Issued":    {color:"#15803d",bg:"#f0fdf4",bd:"#86efac",accent:"#22c55e",icon:"✅"},
  "Closed":               {color:"#14532d",bg:"#dcfce7",bd:"#6ee7b7",accent:"#16a34a",icon:"🎉"},
};

function RefiPipeline({loans,onSelect,onSave}){
  const en=useMemo(()=>loans.map(enrich),[loans]);
  const [dragging,setDragging]=useState(null);
  const [dragOver,setDragOver]=useState(null);

  const ACTIVE_STAGES=["Exploring","LOI Received","Application Submitted","Appraisal Ordered","Commitment Issued","Closed"];

  const byStage={};
  REFI_STAGES.forEach(s=>byStage[s]=[]);
  en.forEach(l=>{const s=l.refiStatus||"Not Started";(byStage[s]=byStage[s]||[]).push(l);});

  const activePipeline=en.filter(l=>l.refiStatus&&l.refiStatus!=="Not Started"&&l.refiStatus!=="Closed");
  const pipelineBal=activePipeline.reduce((s,l)=>s+l.curBal,0);
  const closedBal=(byStage["Closed"]||[]).reduce((s,l)=>s+l.curBal,0);
  const notStarted=byStage["Not Started"]||[];

  const drop=stageId=>{
    if(!dragging||dragging.refiStatus===stageId)return;
    onSave(dragging.id,{refiStatus:stageId});
    setDragging(null);setDragOver(null);
  };

  return(
    <div>
      {/* Header */}
      <div style={{marginBottom:24}}>
        <div style={{fontSize:22,fontWeight:700,color:"var(--t1)",marginBottom:4}}>Refinancing Pipeline</div>
        <div style={{fontSize:13,color:"var(--t3)"}}>Drag cards between stages to track every active refi. Click any card to open the loan detail.</div>
      </div>

      {/* KPIs */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginBottom:28}}>
        {[
          {lbl:"Active In Pipeline",val:activePipeline.length,sub:f$(pipelineBal)+" in process",c:"blue"},
          {lbl:"Not Yet Started",val:notStarted.length,sub:"may need attention",c:"amber"},
          {lbl:"Closed / Refinanced",val:(byStage["Closed"]||[]).length,sub:f$(closedBal)+" completed",c:"green"},
          {lbl:"Total Pipeline Value",val:f$(pipelineBal+closedBal),sub:"active + closed",c:""},
        ].map((k,i)=>(
          <div key={i} className="scard">
            <div className="sc-lbl">{k.lbl}</div>
            <div className={`sc-val${k.c?" "+k.c:""}`}>{k.val}</div>
            <div className="sc-sub">{k.sub}</div>
          </div>
        ))}
      </div>

      {/* Progress strip showing pipeline flow */}
      <div style={{background:"var(--white)",border:"1px solid var(--bd)",borderRadius:14,padding:"16px 20px",marginBottom:24}}>
        <div style={{fontSize:10,fontWeight:700,color:"var(--t3)",textTransform:"uppercase",letterSpacing:".07em",marginBottom:12}}>Pipeline Stages</div>
        <div style={{display:"flex",alignItems:"center",gap:0}}>
          {ACTIVE_STAGES.map((stage,i)=>{
            const meta=STAGE_META[stage];
            const count=(byStage[stage]||[]).length;
            const isLast=i===ACTIVE_STAGES.length-1;
            return(
              <div key={stage} style={{display:"flex",alignItems:"center",flex:1}}>
                <div style={{
                  flex:1,padding:"10px 12px",borderRadius:8,textAlign:"center",
                  background:count>0?meta.bg:"transparent",
                  border:`1px solid ${count>0?meta.bd:"var(--bd)"}`,
                  position:"relative",
                }}>
                  <div style={{fontSize:12,fontWeight:700,color:count>0?meta.color:"var(--t4)"}}>{count>0?count:"—"}</div>
                  <div style={{fontSize:9,fontWeight:500,color:count>0?meta.color:"var(--t4)",marginTop:1,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{stage}</div>
                  {count>0&&<div style={{fontSize:9,color:meta.color,marginTop:1,opacity:.8}}>{f$((byStage[stage]||[]).reduce((s,l)=>s+l.curBal,0))}</div>}
                </div>
                {!isLast&&<div style={{fontSize:14,color:"var(--bd2)",padding:"0 4px",flexShrink:0}}>›</div>}
              </div>
            );
          })}
        </div>
      </div>

      {/* Kanban board — horizontal scroll */}
      <div style={{overflowX:"auto",marginBottom:28,paddingBottom:4}}>
        <div style={{display:"flex",gap:14,alignItems:"flex-start",minWidth:`${ACTIVE_STAGES.length*240}px`}}>
          {ACTIVE_STAGES.map(stage=>{
            const meta=STAGE_META[stage];
            const cards=byStage[stage]||[];
            const isDragOver=dragOver===stage;
            const stageBal=cards.reduce((s,l)=>s+l.curBal,0);
            return(
              <div key={stage}
                onDragOver={e=>{e.preventDefault();setDragOver(stage);}}
                onDragLeave={e=>{if(!e.currentTarget.contains(e.relatedTarget))setDragOver(null);}}
                onDrop={()=>drop(stage)}
                style={{
                  width:240,flexShrink:0,
                  background:isDragOver?meta.bg:"var(--white)",
                  border:`1.5px solid ${isDragOver?meta.accent:"var(--bd)"}`,
                  borderRadius:14,
                  minHeight:180,
                  transition:"all .18s",
                  overflow:"hidden",
                  boxShadow:isDragOver?`0 0 0 3px ${meta.accent}22`:"0 1px 4px rgba(0,0,0,.04)",
                }}
              >
                {/* Colored accent bar at top */}
                <div style={{height:4,background:meta.accent,borderRadius:"14px 14px 0 0"}}/>

                {/* Column header */}
                <div style={{padding:"14px 14px 10px"}}>
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:4}}>
                    <div style={{display:"flex",alignItems:"center",gap:7}}>
                      <span style={{fontSize:14}}>{meta.icon}</span>
                      <span style={{fontSize:12,fontWeight:700,color:"var(--t1)",lineHeight:1.2}}>{stage}</span>
                    </div>
                    <div style={{
                      fontSize:11,fontWeight:700,
                      minWidth:22,height:22,borderRadius:11,
                      background:cards.length>0?meta.bg:"var(--bg)",
                      color:cards.length>0?meta.color:"var(--t4)",
                      border:`1px solid ${cards.length>0?meta.bd:"var(--bd)"}`,
                      display:"flex",alignItems:"center",justifyContent:"center",
                      padding:"0 7px",
                    }}>{cards.length}</div>
                  </div>
                  {cards.length>0&&(
                    <div style={{fontSize:11,fontWeight:600,color:meta.color}}>{f$(stageBal)}</div>
                  )}
                </div>

                {/* Divider */}
                <div style={{height:1,background:"var(--bd)",margin:"0 14px"}}/>

                {/* Cards */}
                <div style={{padding:"10px 10px 12px",display:"flex",flexDirection:"column",gap:8}}>
                  {cards.map(l=>(
                    <div key={l.id}
                      draggable
                      onDragStart={()=>setDragging(l)}
                      onDragEnd={()=>{setDragging(null);setDragOver(null);}}
                      onClick={()=>onSelect(loans.find(x=>x.id===l.id))}
                      style={{
                        background:"var(--white)",
                        border:`1.5px solid ${dragging?.id===l.id?meta.accent:"var(--bd)"}`,
                        borderRadius:10,
                        padding:"12px 13px",
                        cursor:"grab",
                        transition:"box-shadow .15s,transform .15s,border-color .15s",
                        boxShadow:dragging?.id===l.id?"0 8px 24px rgba(0,0,0,.14)":"0 1px 3px rgba(0,0,0,.05)",
                        transform:dragging?.id===l.id?"rotate(2deg) scale(1.03)":"none",
                        opacity:dragging?.id===l.id?0.55:1,
                        userSelect:"none",
                        position:"relative",
                      }}
                      onMouseEnter={e=>{if(!dragging){e.currentTarget.style.boxShadow="0 4px 14px rgba(0,0,0,.10)";e.currentTarget.style.borderColor=meta.bd;}}}
                      onMouseLeave={e=>{if(!dragging){e.currentTarget.style.boxShadow="0 1px 3px rgba(0,0,0,.05)";e.currentTarget.style.borderColor="var(--bd)";}}}
                    >
                      {/* Status urgency accent */}
                      {(l.status==="urgent"||l.status==="matured")&&(
                        <div style={{position:"absolute",top:0,right:0,width:0,height:0,borderStyle:"solid",borderWidth:"0 20px 20px 0",borderColor:`transparent #dc2626 transparent transparent`,borderRadius:"0 10px 0 0"}}/>
                      )}

                      {/* Address */}
                      <div style={{fontSize:12,fontWeight:700,color:"var(--t1)",lineHeight:1.3,marginBottom:3,paddingRight:16}}>{l.addr}</div>
                      {l.entity&&<div style={{fontSize:10,color:"var(--t3)",marginBottom:8}}>{l.entity}</div>}

                      {/* Balance — prominent */}
                      <div style={{fontSize:16,fontWeight:700,color:"var(--t1)",marginBottom:8,lineHeight:1}}>{f$(l.curBal)}</div>

                      {/* Maturity chip */}
                      <div style={{marginBottom:8}}><MatChip loan={l}/></div>

                      {/* Rate + lender row */}
                      <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:l.activityLog?.length>0?8:0}}>
                        <span style={{
                          fontSize:10,fontWeight:600,padding:"2px 8px",borderRadius:20,
                          background:l.rate>7?"var(--rbg)":l.rate>5?"var(--abg)":"var(--gbg)",
                          color:l.rate>7?"var(--red)":l.rate>5?"var(--amber)":"var(--green)",
                        }}>{fPct(l.rate)}</span>
                        <span style={{fontSize:10,color:"var(--t3)",padding:"2px 0",lineHeight:"20px"}}>{l.loanType}</span>
                      </div>

                      {/* Last activity note */}
                      {l.activityLog?.length>0&&(
                        <div style={{
                          fontSize:10,color:"var(--t3)",
                          borderTop:"1px solid var(--bd)",paddingTop:8,
                          lineHeight:1.4,
                          display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical",overflow:"hidden",
                        }}>
                          💬 {l.activityLog[l.activityLog.length-1].text}
                        </div>
                      )}
                    </div>
                  ))}

                  {cards.length===0&&(
                    <div style={{
                      padding:"24px 12px",textAlign:"center",
                      border:`2px dashed ${isDragOver?meta.accent:"var(--bd)"}`,
                      borderRadius:10,
                      transition:"border-color .15s",
                    }}>
                      <div style={{fontSize:20,marginBottom:6,opacity:.3}}>{meta.icon}</div>
                      <div style={{fontSize:11,color:isDragOver?meta.color:"var(--t4)",fontWeight:isDragOver?600:400}}>
                        {isDragOver?"Drop here":"Empty"}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Not Started pool */}
      {notStarted.length>0&&(
        <div>
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12}}>
            <div style={{fontSize:15,fontWeight:700,color:"var(--t1)"}}>Not Yet Started</div>
            <span style={{
              fontSize:10,fontWeight:600,padding:"2px 10px",borderRadius:20,
              background:"var(--abg)",color:"var(--amber)",border:"1px solid var(--abd)",
            }}>{notStarted.length} loans</span>
            <span style={{fontSize:11,color:"var(--t3)"}}>— drag a row into a column above to begin tracking</span>
          </div>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr><th>Address</th><th>Lender</th><th>Balance</th><th>Rate</th><th>Maturity</th><th>Prepay</th><th>Priority</th></tr>
              </thead>
              <tbody>
                {[...notStarted].sort((a,b)=>a.daysLeft-b.daysLeft).map(l=>{
                  const isUrgent=l.status==="urgent"||l.status==="matured";
                  const isSoon=l.status==="soon";
                  return(
                    <tr key={l.id}
                      draggable
                      onDragStart={()=>setDragging(l)}
                      onDragEnd={()=>{setDragging(null);setDragOver(null);}}
                      onClick={()=>onSelect(loans.find(x=>x.id===l.id))}
                    >
                      <td>
                        <div style={{display:"flex",alignItems:"center",gap:8}}>
                          {isUrgent&&<div style={{width:3,height:32,borderRadius:2,background:"var(--red)",flexShrink:0}}/>}
                          {isSoon&&!isUrgent&&<div style={{width:3,height:32,borderRadius:2,background:"var(--amber)",flexShrink:0}}/>}
                          {!isUrgent&&!isSoon&&<div style={{width:3,height:32,borderRadius:2,background:"var(--bd2)",flexShrink:0}}/>}
                          <div>
                            <div className="td-a">{l.addr}</div>
                            <div className="td-b">{l.entity||l.lenderType}</div>
                          </div>
                        </div>
                      </td>
                      <td><span style={{fontSize:12,color:"var(--t2)"}}>{l.lender}</span></td>
                      <td><span className="td-n">{f$(l.curBal)}</span></td>
                      <td><span className={`td-n${l.rate>7?" red":l.rate>5?" amber":" green"}`}>{fPct(l.rate)}</span></td>
                      <td><MatChip loan={l}/></td>
                      <td><span style={{fontSize:11,color:"var(--t3)"}}>{l.prepay||"None"}</span></td>
                      <td>
                        <span style={{
                          fontSize:10,fontWeight:700,padding:"3px 10px",borderRadius:20,
                          background:isUrgent?"var(--rbg)":isSoon?"var(--abg)":"var(--bg)",
                          color:isUrgent?"var(--red)":isSoon?"var(--amber)":"var(--t3)",
                          border:`1px solid ${isUrgent?"var(--rbd)":isSoon?"var(--abd)":"var(--bd)"}`,
                        }}>
                          {isUrgent?"🔴 High":isSoon?"🟡 Medium":"⚪ Low"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─────────── CASHFLOW IMPACT ─────────── */
function CashflowChart({months, height=180}){
  const [hov,setHov]=useState(null);
  const W=780,H=height,PAD={t:16,r:16,b:40,l:72};
  const cW=W-PAD.l-PAD.r, cH=H-PAD.t-PAD.b;
  const maxDS=Math.max(...months.map(m=>m.totalDS));
  const ticks=[0,.25,.5,.75,1];
  return(
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{display:"block",overflow:"visible"}}>
      <defs>
        <linearGradient id="cf-int" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ef4444" stopOpacity=".85"/>
          <stop offset="100%" stopColor="#dc2626" stopOpacity=".6"/>
        </linearGradient>
        <linearGradient id="cf-pri" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#22c55e" stopOpacity=".85"/>
          <stop offset="100%" stopColor="#16a34a" stopOpacity=".6"/>
        </linearGradient>
      </defs>
      <rect x={PAD.l} y={PAD.t} width={cW} height={cH} fill="#fafafa" rx={4}/>
      {ticks.map(p=>{
        const y=PAD.t+cH*(1-p);
        return <g key={p}>
          <line x1={PAD.l} y1={y} x2={PAD.l+cW} y2={y} stroke={p===0?"#cbd5e1":"#e2e8f0"} strokeWidth={p===0?1.5:1} strokeDasharray={p===0?"":"4 3"}/>
          <text x={PAD.l-8} y={y+4} textAnchor="end" fontSize="9" fill="#94a3b8" fontFamily="Inter,sans-serif">{p>0?`$${(maxDS*p/1000).toFixed(0)}K`:""}</text>
        </g>;
      })}
      {months.map((m,i)=>{
        const bw=Math.max(2,(cW/months.length)-2);
        const x=PAD.l+i*(cW/months.length)+1;
        const intH=Math.max(1,(m.interest/maxDS)*cH);
        const priH=Math.max(0,(m.principal/maxDS)*cH);
        const isHov=hov===i;
        const label=m.label;
        return <g key={i} onMouseEnter={()=>setHov(i)} onMouseLeave={()=>setHov(null)}>
          {/* principal (bottom) */}
          <rect x={x} y={PAD.t+cH-intH-priH} width={bw} height={priH} fill="url(#cf-pri)" rx={priH>3?2:0}/>
          {/* interest (on top) */}
          <rect x={x} y={PAD.t+cH-intH} width={bw} height={intH} fill="url(#cf-int)" rx={2}/>
          {/* x label every 12 */}
          {i%12===0&&<text x={x+bw/2} y={H-6} textAnchor="middle" fontSize="9" fill="#94a3b8" fontFamily="Inter,sans-serif">{label}</text>}
          {/* tooltip */}
          {isHov&&<g style={{pointerEvents:"none"}}>
            <rect x={Math.min(x-30,W-140)} y={PAD.t+cH-intH-priH-52} width={130} height={48} rx={7} fill="#0f172a" opacity={.93}/>
            <text x={Math.min(x-30,W-140)+65} y={PAD.t+cH-intH-priH-38} textAnchor="middle" fontSize="10" fontWeight="700" fill="white" fontFamily="Inter,sans-serif">{label} — ${((m.interest+m.principal)/1000).toFixed(0)}K/mo</text>
            <text x={Math.min(x-30,W-140)+65} y={PAD.t+cH-intH-priH-24} textAnchor="middle" fontSize="9" fill="#94a3b8" fontFamily="Inter,sans-serif">Int ${(m.interest/1000).toFixed(0)}K · Pri ${(m.principal/1000).toFixed(0)}K</text>
          </g>}
        </g>;
      })}
      <line x1={PAD.l} y1={PAD.t} x2={PAD.l} y2={PAD.t+cH} stroke="#e2e8f0" strokeWidth={1}/>
    </svg>
  );
}

function CashflowImpact({loans,onSelect}){
  const en=useMemo(()=>loans.map(enrich),[loans]);
  const [horizon,setHorizon]=useState(60);
  const [rateShock,setRateShock]=useState(0);

  // Build month-by-month cashflow for the next N months
  const months=useMemo(()=>{
    const rows=[];
    for(let m=0;m<horizon;m++){
      const d=new Date(TODAY);d.setMonth(d.getMonth()+m);
      const label=d.toLocaleDateString("en-US",{month:"short",year:"2-digit"});
      let interest=0,principal=0,balloon=0;
      en.forEach(l=>{
        // is loan active this month?
        const loanStart=new Date(l.origDate);
        const loanEnd=new Date(l.maturityDate);
        const cur=new Date(TODAY);cur.setMonth(cur.getMonth()+m);
        if(cur<loanStart||cur>loanEnd)return;
        const elapsed=mosBetween(l.origDate,TODAY_STR)+m;
        const amM=(l.amortYears||l.termYears||1)*12;
        const effectiveRate=l.loanType==="ARM"?l.rate+rateShock:l.rate;
        const mr=effectiveRate/100/12;
        const curBal=l.interestOnly?l.origBalance:Math.max(0,calcBal(l.origBalance,effectiveRate,amM,elapsed));
        const mo_int=curBal*mr;
        const pmt=l.interestOnly?mo_int:calcPmt(l.origBalance,effectiveRate,amM);
        const mo_pri=l.interestOnly?0:Math.max(0,Math.min(pmt-mo_int,curBal));
        interest+=mo_int;
        principal+=mo_pri;
        // balloon: if this is the maturity month
        const matMos=mosBetween(TODAY_STR,l.maturityDate);
        if(m===matMos&&!l.interestOnly){
          balloon+=Math.max(0,calcBal(l.origBalance,effectiveRate,amM,elapsed));
        }
      });
      rows.push({label,month:m,interest,principal,totalDS:interest+principal,balloon});
    }
    return rows;
  },[en,horizon,rateShock]);

  const totalMonthlyDS=months[0]?.totalDS||0;
  const totalAnnualDS=months.slice(0,12).reduce((s,m)=>s+m.totalDS,0);
  const totalInterest=months.reduce((s,m)=>s+m.interest,0);
  const totalPrincipal=months.reduce((s,m)=>s+m.principal,0);
  const balloonMonths=months.filter(m=>m.balloon>0);
  const peakMonth=months.reduce((p,m)=>m.totalDS>p.totalDS?m:p,months[0]||{totalDS:0,label:""});

  const armLoans=en.filter(l=>l.loanType==="ARM");
  const armExposure=armLoans.reduce((s,l)=>s+l.curBal,0);
  const rateShockImpact=armExposure*(rateShock/100/12)*12;

  // Per-loan monthly DS table
  const loanDS=en.map(l=>{
    const amM=(l.amortYears||l.termYears||1)*12;
    const elapsed=mosBetween(l.origDate,TODAY_STR);
    const curBal=l.interestOnly?l.origBalance:Math.max(0,calcBal(l.origBalance,l.rate,amM,elapsed));
    const mr=l.rate/100/12;
    const mo_int=curBal*mr;
    const pmt=l.interestOnly?mo_int:calcPmt(l.origBalance,l.rate,amM);
    const mo_pri=l.interestOnly?0:Math.max(0,pmt-mo_int);
    return{...l,curBal,mo_int,mo_pri,totalDS:mo_int+mo_pri,pct:(mo_int+mo_pri)/totalMonthlyDS*100};
  }).sort((a,b)=>b.totalDS-a.totalDS);

  const maxLoanDS=Math.max(...loanDS.map(l=>l.totalDS));

  return(<div>
    {/* Header */}
    <div style={{marginBottom:24}}>
      <div style={{fontSize:22,fontWeight:700,color:"var(--t1)",marginBottom:4}}>Cashflow Impact</div>
      <div style={{fontSize:13,color:"var(--t3)"}}>Total debt service, interest vs. principal breakdown, balloon exposure, and rate shock analysis.</div>
    </div>

    {/* Controls */}
    <div style={{display:"flex",gap:12,alignItems:"center",marginBottom:20,background:"var(--white)",border:"1px solid var(--bd)",borderRadius:12,padding:"12px 16px"}}>
      <div style={{fontSize:11,fontWeight:700,color:"var(--t3)",textTransform:"uppercase",letterSpacing:".06em"}}>Horizon</div>
      {[12,36,60,120].map(h=>(
        <button key={h} onClick={()=>setHorizon(h)} style={{
          padding:"5px 14px",borderRadius:20,border:"1px solid",fontSize:11,fontWeight:600,cursor:"pointer",
          background:horizon===h?"var(--t1)":"var(--white)",
          color:horizon===h?"var(--white)":"var(--t3)",
          borderColor:horizon===h?"var(--t1)":"var(--bd)",
        }}>{h===12?"1yr":h===36?"3yr":h===60?"5yr":"10yr"}</button>
      ))}
      <div style={{width:1,height:20,background:"var(--bd)",margin:"0 4px"}}/>
      <div style={{fontSize:11,fontWeight:700,color:"var(--t3)",textTransform:"uppercase",letterSpacing:".06em"}}>ARM Rate Shock</div>
      {[0,0.5,1,2].map(r=>(
        <button key={r} onClick={()=>setRateShock(r)} style={{
          padding:"5px 14px",borderRadius:20,border:"1px solid",fontSize:11,fontWeight:600,cursor:"pointer",
          background:rateShock===r?(r===0?"var(--t1)":"#dc2626"):"var(--white)",
          color:rateShock===r?"var(--white)":r===0?"var(--t3)":"var(--red)",
          borderColor:rateShock===r?(r===0?"var(--t1)":"#dc2626"):r===0?"var(--bd)":"var(--rbd)",
        }}>+{r}%</button>
      ))}
      {rateShock>0&&armLoans.length>0&&<div style={{fontSize:11,color:"var(--red)",fontWeight:600}}>⚠ +{f$(rateShockImpact)}/yr on {armLoans.length} ARM loan{armLoans.length>1?"s":""}</div>}
    </div>

    {/* KPI cards */}
    <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:10,marginBottom:20}}>
      {[
        {lbl:"Monthly Debt Service",val:f$(totalMonthlyDS),sub:"current run rate",c:""},
        {lbl:"Annual Debt Service",val:f$(totalAnnualDS),sub:`next 12 months`,c:""},
        {lbl:`Interest Over ${horizon/12<1?horizon+"mo":(horizon/12)+"yr"}`,val:f$(totalInterest),sub:"total interest cost",c:"red"},
        {lbl:`Principal Over ${horizon/12<1?horizon+"mo":(horizon/12)+"yr"}`,val:f$(totalPrincipal),sub:"equity built",c:"green"},
        {lbl:"Balloon Payments",val:balloonMonths.length,sub:balloonMonths.length>0?f$(balloonMonths.reduce((s,m)=>s+m.balloon,0))+" total":"none in period",c:balloonMonths.length>0?"amber":""},
      ].map((k,i)=>(
        <div key={i} style={{background:"var(--white)",border:"1px solid var(--bd)",borderRadius:12,padding:"14px 16px"}}>
          <div style={{fontSize:9,fontWeight:700,color:"var(--t3)",textTransform:"uppercase",letterSpacing:".06em",marginBottom:7}}>{k.lbl}</div>
          <div style={{fontSize:18,fontWeight:700,color:k.c==="red"?"var(--red)":k.c==="green"?"var(--green)":k.c==="amber"?"var(--amber)":"var(--t1)",lineHeight:1,marginBottom:3}}>{k.val}</div>
          <div style={{fontSize:10,color:"var(--t3)"}}>{k.sub}</div>
        </div>
      ))}
    </div>

    {/* Stacked bar chart */}
    <div style={{background:"var(--white)",border:"1px solid var(--bd)",borderRadius:14,padding:"20px 20px 12px",marginBottom:20,boxShadow:"0 1px 4px rgba(0,0,0,.04)"}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14}}>
        <div>
          <div style={{fontSize:14,fontWeight:700,color:"var(--t1)"}}>Monthly Debt Service</div>
          <div style={{fontSize:11,color:"var(--t3)",marginTop:2}}>Interest + principal by month · hover for details</div>
        </div>
        <div style={{display:"flex",gap:14}}>
          {[{c:"#dc2626",l:"Interest"},{c:"#16a34a",l:"Principal"}].map(x=>(
            <div key={x.l} style={{display:"flex",alignItems:"center",gap:5,fontSize:10,color:"var(--t3)"}}>
              <div style={{width:10,height:10,borderRadius:2,background:x.c,opacity:.8}}/>
              {x.l}
            </div>
          ))}
        </div>
      </div>
      <CashflowChart months={months}/>
    </div>

    {/* Two col: balloon schedule + per-loan breakdown */}
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:20}}>
      {/* Balloon payments */}
      <div style={{background:"var(--white)",border:"1px solid var(--bd)",borderRadius:14,padding:"18px 20px"}}>
        <div style={{fontSize:14,fontWeight:700,color:"var(--t1)",marginBottom:4}}>Balloon Payments in Window</div>
        <div style={{fontSize:11,color:"var(--t3)",marginBottom:14}}>{horizon/12<2?horizon+"mo":Math.round(horizon/12)+"yr"} outlook — click to open loan</div>
        {balloonMonths.length===0
          ?<div style={{textAlign:"center",padding:"30px 0"}}>
              <div style={{fontSize:24,opacity:.15,marginBottom:8}}>✅</div>
              <div style={{fontSize:12,color:"var(--t3)"}}>No balloon payments in this window</div>
            </div>
          :balloonMonths.map((m,i)=>{
            const loan=en.find(l=>{const mm=mosBetween(TODAY_STR,l.maturityDate);return mm===m.month;});
            if(!loan)return null;
            const isUrgent=m.month<=6;
            return(
              <div key={i} onClick={()=>onSelect(loans.find(x=>x.id===loan.id))}
                style={{
                  display:"flex",alignItems:"center",gap:12,padding:"12px 14px",marginBottom:8,
                  background:isUrgent?"var(--rbg)":"var(--bg)",
                  border:`1px solid ${isUrgent?"var(--rbd)":"var(--bd)"}`,
                  borderRadius:10,cursor:"pointer",transition:"opacity .15s",
                }}>
                <div style={{flexShrink:0}}>
                  <div style={{fontSize:11,fontWeight:700,color:isUrgent?"var(--red)":"var(--amber)"}}>{m.label}</div>
                  <div style={{fontSize:9,color:"var(--t3)",marginTop:1}}>{m.month} mo away</div>
                </div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:12,fontWeight:700,color:"var(--t1)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{loan.addr}</div>
                  <div style={{fontSize:10,color:"var(--t3)"}}>{loan.lender}</div>
                </div>
                <div style={{textAlign:"right",flexShrink:0}}>
                  <div style={{fontSize:13,fontWeight:700,color:isUrgent?"var(--red)":"var(--t1)"}}>{f$(m.balloon)}</div>
                  <div style={{fontSize:9,color:"var(--t3)"}}>balloon due</div>
                </div>
              </div>
            );
          })}
      </div>

      {/* Per-loan DS breakdown */}
      <div style={{background:"var(--white)",border:"1px solid var(--bd)",borderRadius:14,padding:"18px 20px"}}>
        <div style={{fontSize:14,fontWeight:700,color:"var(--t1)",marginBottom:4}}>Monthly DS by Loan</div>
        <div style={{fontSize:11,color:"var(--t3)",marginBottom:14}}>Current month · click to open</div>
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          {loanDS.map(l=>(
            <div key={l.id} onClick={()=>onSelect(loans.find(x=>x.id===l.id))}
              style={{cursor:"pointer"}}
              onMouseEnter={e=>e.currentTarget.style.opacity=".8"}
              onMouseLeave={e=>e.currentTarget.style.opacity="1"}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:4}}>
                <div style={{fontSize:11,fontWeight:600,color:"var(--t1)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:"60%"}}>{l.addr}</div>
                <div style={{display:"flex",gap:10,alignItems:"baseline",flexShrink:0}}>
                  <span style={{fontSize:10,color:"var(--red)"}}>{f$(l.mo_int)} int</span>
                  <span style={{fontSize:11,fontWeight:700,color:"var(--t1)"}}>{f$(l.totalDS)}</span>
                </div>
              </div>
              {/* Stacked mini bar */}
              <div style={{height:6,borderRadius:3,background:"var(--bd)",overflow:"hidden",display:"flex"}}>
                <div style={{width:`${(l.mo_int/maxLoanDS)*100}%`,background:"#ef4444",opacity:.75,transition:"width .4s"}}/>
                <div style={{width:`${(l.mo_pri/maxLoanDS)*100}%`,background:"#22c55e",opacity:.75,transition:"width .4s"}}/>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>

    {/* Full loan DS table */}
    <div style={{fontSize:14,fontWeight:700,color:"var(--t1)",marginBottom:10}}>Debt Service Detail — All Loans</div>
    <div className="tbl-wrap">
      <table className="tbl">
        <thead><tr><th>Address</th><th>Balance</th><th>Rate</th><th>Monthly Interest</th><th>Monthly Principal</th><th>Total DS / mo</th><th>Annual DS</th><th>% of Portfolio DS</th></tr></thead>
        <tbody>
          {loanDS.map(l=>(
            <tr key={l.id} onClick={()=>onSelect(loans.find(x=>x.id===l.id))}>
              <td><div className="td-a">{l.addr}</div><div className="td-b">{l.entity||l.lenderType}</div></td>
              <td><span className="td-n">{f$(l.curBal)}</span></td>
              <td><span className={`td-n${l.rate>7?" red":l.rate>5?" amber":" green"}`}>{fPct(l.rate)}</span></td>
              <td><span style={{fontSize:12,color:"var(--red)",fontWeight:500}}>{f$(l.mo_int)}</span></td>
              <td><span style={{fontSize:12,color:"var(--green)",fontWeight:500}}>{l.interestOnly?<span style={{color:"var(--t4)"}}>IO</span>:f$(l.mo_pri)}</span></td>
              <td><span style={{fontSize:13,fontWeight:700,color:"var(--t1)"}}>{f$(l.totalDS)}</span></td>
              <td><span className="td-n">{f$(l.totalDS*12)}</span></td>
              <td>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <div style={{width:60,height:5,background:"var(--bd)",borderRadius:3,overflow:"hidden"}}>
                    <div style={{width:`${l.pct}%`,height:5,background:"var(--t1)",borderRadius:3,opacity:.6}}/>
                  </div>
                  <span style={{fontSize:11,color:"var(--t3)"}}>{l.pct.toFixed(1)}%</span>
                </div>
              </td>
            </tr>
          ))}
          {/* Totals row */}
          <tr style={{background:"var(--bg)"}}>
            <td colSpan={3}><span style={{fontSize:12,fontWeight:700,color:"var(--t1)"}}>TOTAL</span></td>
            <td><span style={{fontSize:12,fontWeight:700,color:"var(--red)"}}>{f$(loanDS.reduce((s,l)=>s+l.mo_int,0))}</span></td>
            <td><span style={{fontSize:12,fontWeight:700,color:"var(--green)"}}>{f$(loanDS.reduce((s,l)=>s+l.mo_pri,0))}</span></td>
            <td><span style={{fontSize:14,fontWeight:700,color:"var(--t1)"}}>{f$(totalMonthlyDS)}</span></td>
            <td><span style={{fontSize:12,fontWeight:700,color:"var(--t1)"}}>{f$(totalAnnualDS)}</span></td>
            <td><span style={{fontSize:11,color:"var(--t3)"}}>100%</span></td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>);
}

/* ─────────── CONTACTS & DOCS ─────────── */
const DOC_CATS=["Loan Agreement","Promissory Note","Appraisal","Title Policy","Survey","Environmental","Insurance","Tax Records","Correspondence","Other"];
const CONTACT_ROLES=["Servicer","Broker","Lender Contact","Attorney","Appraiser","Title Company","Insurance Agent","Accountant","Property Manager","Other"];

// Keep old combined view as legacy — replaced by ContactsView + DocumentsView below
function ContactsDocs({loans,onSelect}){
  const [selId,setSelId]=useState(String(loans[0]?.id||""));
  const [contacts,setContacts]=useState({});
  const [docs,setDocs]=useState({});
  const [tab,setTab]=useState("contacts");
  const [showAddContact,setShowAddContact]=useState(false);
  const [showAddDoc,setShowAddDoc]=useState(false);
  const [loaded,setLoaded]=useState(false);

  // New contact form state
  const blankC={role:"Servicer",name:"",company:"",phone:"",email:"",notes:""};
  const [nc,setNc]=useState(blankC);

  // New doc form state
  const blankD={category:"Loan Agreement",name:"",date:"",notes:"",fileData:null,fileName:null,fileSize:null,fileType:null};
  const [nd,setNd]=useState(blankD);
  const [uploading,setUploading]=useState(false);

  const sel=loans.find(l=>String(l.id)===selId);
  const curContacts=contacts[selId]||[];
  const curDocs=docs[selId]||[];

  // Load from storage
  useEffect(()=>{(async()=>{
    try{
      const cr=await supaStorage.get("meridian-contacts");
      const dr=await supaStorage.get("meridian-docs");
      if(cr?.value)setContacts(JSON.parse(cr.value));
      if(dr?.value)setDocs(JSON.parse(dr.value));
    }catch{}
    setLoaded(true);
  })();},[]);

  // Save contacts
  useEffect(()=>{if(!loaded)return;(async()=>{try{await supaStorage.set("meridian-contacts",JSON.stringify(contacts));}catch{}})();},[contacts,loaded]);
  // Save docs (base64 - large)
  useEffect(()=>{if(!loaded)return;(async()=>{try{await supaStorage.set("meridian-docs",JSON.stringify(docs));}catch{}})();},[docs,loaded]);

  const addContact=()=>{
    if(!nc.name)return;
    const entry={...nc,id:Date.now()};
    setContacts(p=>({...p,[selId]:[...(p[selId]||[]),entry]}));
    setNc(blankC);setShowAddContact(false);
  };
  const delContact=id=>setContacts(p=>({...p,[selId]:(p[selId]||[]).filter(c=>c.id!==id)}));

  const handleFile=e=>{
    const file=e.target.files?.[0];
    if(!file)return;
    setUploading(true);
    const reader=new FileReader();
    reader.onload=ev=>{
      setNd(d=>({...d,fileData:ev.target.result,fileName:file.name,fileSize:file.size,fileType:file.type,name:d.name||file.name}));
      setUploading(false);
    };
    reader.readAsDataURL(file);
  };

  const addDoc=()=>{
    if(!nd.name)return;
    const entry={...nd,id:Date.now(),uploaded:TODAY_STR};
    setDocs(p=>({...p,[selId]:[...(p[selId]||[]),entry]}));
    setNd(blankD);setShowAddDoc(false);
  };
  const delDoc=id=>setDocs(p=>({...p,[selId]:(p[selId]||[]).filter(d=>d.id!==id)}));

  const downloadDoc=doc=>{
    if(!doc.fileData)return;
    const a=document.createElement("a");
    a.href=doc.fileData;a.download=doc.fileName||doc.name;a.click();
  };

  const fSize=b=>{if(!b)return"";if(b>1e6)return`${(b/1e6).toFixed(1)}MB`;return`${(b/1000).toFixed(0)}KB`;};
  const fileIcon=t=>{
    if(!t)return"📄";
    if(t.includes("pdf"))return"📕";
    if(t.includes("image"))return"🖼️";
    if(t.includes("word")||t.includes("doc"))return"📝";
    if(t.includes("sheet")||t.includes("excel")||t.includes("csv"))return"📊";
    return"📄";
  };

  // Portfolio-wide stats
  const totalContacts=Object.values(contacts).reduce((s,a)=>s+a.length,0);
  const totalDocs=Object.values(docs).reduce((s,a)=>s+a.length,0);
  const loansWithDocs=Object.keys(docs).filter(k=>(docs[k]||[]).length>0).length;

  return(<div>
    {/* Header */}
    <div style={{marginBottom:20}}>
      <div style={{fontSize:22,fontWeight:700,color:"var(--t1)",marginBottom:4}}>Contacts & Documents</div>
      <div style={{fontSize:13,color:"var(--t3)"}}>Store servicer contacts, brokers, attorneys, and critical loan documents — linked per property.</div>
    </div>

    {/* Portfolio stats */}
    <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:20}}>
      {[
        {lbl:"Total Contacts",val:totalContacts,sub:"across all loans",c:""},
        {lbl:"Total Documents",val:totalDocs,sub:"uploaded files",c:"blue"},
        {lbl:"Loans with Docs",val:`${loansWithDocs}/${loans.length}`,sub:"file coverage",c:loansWithDocs<loans.length?"amber":"green"},
        {lbl:"Loans Missing Docs",val:loans.length-loansWithDocs,sub:"no files uploaded",c:loans.length-loansWithDocs>0?"red":""},
      ].map((k,i)=>(
        <div key={i} style={{background:"var(--white)",border:"1px solid var(--bd)",borderRadius:12,padding:"14px 16px"}}>
          <div style={{fontSize:9,fontWeight:700,color:"var(--t3)",textTransform:"uppercase",letterSpacing:".06em",marginBottom:7}}>{k.lbl}</div>
          <div style={{fontSize:22,fontWeight:700,color:k.c==="red"?"var(--red)":k.c==="green"?"var(--green)":k.c==="amber"?"var(--amber)":k.c==="blue"?"var(--blue)":"var(--t1)",lineHeight:1,marginBottom:3}}>{k.val}</div>
          <div style={{fontSize:10,color:"var(--t3)"}}>{k.sub}</div>
        </div>
      ))}
    </div>

    {/* Layout: loan selector sidebar + content */}
    <div style={{display:"grid",gridTemplateColumns:"240px 1fr",gap:16,alignItems:"start"}}>

      {/* Loan list */}
      <div style={{background:"var(--white)",border:"1px solid var(--bd)",borderRadius:14,overflow:"hidden",position:"sticky",top:0}}>
        <div style={{padding:"12px 14px",borderBottom:"1px solid var(--bd)",fontSize:10,fontWeight:700,color:"var(--t3)",textTransform:"uppercase",letterSpacing:".07em"}}>Select Property</div>
        <div style={{maxHeight:520,overflowY:"auto"}}>
          {loans.map(l=>{
            const cCount=(contacts[String(l.id)]||[]).length;
            const dCount=(docs[String(l.id)]||[]).length;
            const isActive=String(l.id)===selId;
            const el=enrich(l);
            return(
              <div key={l.id} onClick={()=>setSelId(String(l.id))}
                style={{
                  padding:"11px 14px",cursor:"pointer",
                  background:isActive?"var(--bg)":"transparent",
                  borderLeft:`2px solid ${isActive?"var(--t1)":"transparent"}`,
                  borderBottom:"1px solid var(--bd)",
                  transition:"all .1s",
                }}>
                <div style={{fontSize:11,fontWeight:700,color:isActive?"var(--t1)":"var(--t2)",marginBottom:3,lineHeight:1.3}}>{l.addr}</div>
                <div style={{display:"flex",gap:6,alignItems:"center"}}>
                  {cCount>0&&<span style={{fontSize:9,fontWeight:600,padding:"1px 6px",borderRadius:10,background:"var(--bbg)",color:"var(--blue)",border:"1px solid var(--bbd)"}}>👤 {cCount}</span>}
                  {dCount>0&&<span style={{fontSize:9,fontWeight:600,padding:"1px 6px",borderRadius:10,background:"var(--gbg)",color:"var(--green)",border:"1px solid var(--gbd)"}}>📄 {dCount}</span>}
                  {cCount===0&&dCount===0&&<span style={{fontSize:9,color:"var(--t4)"}}>No records</span>}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Content area */}
      <div>
        {sel&&<>
          {/* Property header */}
          <div style={{background:"var(--white)",border:"1px solid var(--bd)",borderRadius:14,padding:"16px 20px",marginBottom:14}}>
            <div style={{fontSize:16,fontWeight:700,color:"var(--t1)",marginBottom:2}}>{sel.addr}</div>
            <div style={{fontSize:11,color:"var(--t3)"}}>{sel.entity||sel.lender} · {fPct(sel.rate)} · matures {fDateS(sel.maturityDate)}</div>
          </div>

          {/* Tabs */}
          <div style={{display:"flex",gap:2,marginBottom:14,background:"var(--white)",borderRadius:10,padding:3,border:"1px solid var(--bd)",width:"fit-content"}}>
            {[["contacts",`👤 Contacts (${curContacts.length})`],["docs",`📄 Documents (${curDocs.length})`]].map(([id,lbl])=>(
              <button key={id} onClick={()=>setTab(id)} style={{padding:"7px 18px",borderRadius:8,border:"none",fontSize:12,fontWeight:tab===id?700:400,background:tab===id?"var(--t1)":"transparent",color:tab===id?"var(--white)":"var(--t3)",cursor:"pointer"}}>
                {lbl}
              </button>
            ))}
          </div>

          {/* CONTACTS TAB */}
          {tab==="contacts"&&<>
            <div style={{display:"flex",justifyContent:"flex-end",marginBottom:12}}>
              <button className="btn-dark" onClick={()=>setShowAddContact(true)}>+ Add Contact</button>
            </div>

            {curContacts.length===0&&!showAddContact&&(
              <div style={{background:"var(--white)",border:"1px solid var(--bd)",borderRadius:14,padding:"48px 24px",textAlign:"center"}}>
                <div style={{fontSize:32,opacity:.15,marginBottom:12}}>👤</div>
                <div style={{fontSize:14,fontWeight:600,color:"var(--t3)",marginBottom:6}}>No contacts for this property</div>
                <div style={{fontSize:12,color:"var(--t4)",marginBottom:16}}>Add servicers, brokers, attorneys, and other key contacts.</div>
                <button className="btn-dark" onClick={()=>setShowAddContact(true)}>+ Add First Contact</button>
              </div>
            )}

            {/* Add contact form */}
            {showAddContact&&(
              <div style={{background:"var(--white)",border:"1px solid var(--bd)",borderRadius:14,padding:"20px",marginBottom:14,boxShadow:"0 4px 16px rgba(0,0,0,.07)"}}>
                <div style={{fontSize:13,fontWeight:700,color:"var(--t1)",marginBottom:14}}>New Contact</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
                  <div>
                    <div className="flbl" style={{display:"block",marginBottom:4}}>Role</div>
                    <select className="finp" value={nc.role} onChange={e=>setNc(p=>({...p,role:e.target.value}))}>
                      {CONTACT_ROLES.map(r=><option key={r}>{r}</option>)}
                    </select>
                  </div>
                  <div>
                    <div className="flbl" style={{display:"block",marginBottom:4}}>Full Name *</div>
                    <input className="finp" placeholder="Jane Smith" value={nc.name} onChange={e=>setNc(p=>({...p,name:e.target.value}))}/>
                  </div>
                  <div>
                    <div className="flbl" style={{display:"block",marginBottom:4}}>Company</div>
                    <input className="finp" placeholder="Arbor Realty" value={nc.company} onChange={e=>setNc(p=>({...p,company:e.target.value}))}/>
                  </div>
                  <div>
                    <div className="flbl" style={{display:"block",marginBottom:4}}>Phone</div>
                    <input className="finp" placeholder="212-555-0100" value={nc.phone} onChange={e=>setNc(p=>({...p,phone:e.target.value}))}/>
                  </div>
                  <div style={{gridColumn:"span 2"}}>
                    <div className="flbl" style={{display:"block",marginBottom:4}}>Email</div>
                    <input className="finp" placeholder="jane@example.com" value={nc.email} onChange={e=>setNc(p=>({...p,email:e.target.value}))}/>
                  </div>
                  <div style={{gridColumn:"span 2"}}>
                    <div className="flbl" style={{display:"block",marginBottom:4}}>Notes</div>
                    <textarea className="notes-ta" rows={2} placeholder="Key notes or context…" value={nc.notes} onChange={e=>setNc(p=>({...p,notes:e.target.value}))}/>
                  </div>
                </div>
                <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
                  <button className="btn-light" onClick={()=>{setShowAddContact(false);setNc(blankC);}}>Cancel</button>
                  <button className="btn-dark" onClick={addContact}>Save Contact</button>
                </div>
              </div>
            )}

            {/* Contact cards */}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
              {curContacts.map(c=>(
                <div key={c.id} style={{background:"var(--white)",border:"1px solid var(--bd)",borderRadius:12,padding:"16px 18px",position:"relative"}}>
                  <button onClick={()=>delContact(c.id)} style={{position:"absolute",top:10,right:10,background:"none",border:"none",cursor:"pointer",fontSize:11,color:"var(--t4)",padding:"2px 5px",borderRadius:4}} title="Remove">✕</button>
                  <div style={{display:"flex",gap:11,alignItems:"flex-start"}}>
                    <div style={{width:36,height:36,borderRadius:"50%",background:"var(--bg)",border:"1px solid var(--bd)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,flexShrink:0}}>
                      {c.role==="Servicer"?"🏦":c.role==="Broker"?"🤝":c.role==="Attorney"?"⚖️":c.role==="Appraiser"?"🏠":c.role==="Insurance Agent"?"🛡️":"👤"}
                    </div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:13,fontWeight:700,color:"var(--t1)",marginBottom:1}}>{c.name}</div>
                      {c.company&&<div style={{fontSize:11,color:"var(--t3)",marginBottom:4}}>{c.company}</div>}
                      <span style={{fontSize:10,fontWeight:600,padding:"2px 8px",borderRadius:20,background:"var(--bbg)",color:"var(--blue)",border:"1px solid var(--bbd)"}}>{c.role}</span>
                      <div style={{marginTop:10,display:"flex",flexDirection:"column",gap:5}}>
                        {c.phone&&<div style={{display:"flex",alignItems:"center",gap:6}}>
                          <span style={{fontSize:11,color:"var(--t3)"}}>📞</span>
                          <a href={`tel:${c.phone}`} style={{fontSize:11,color:"var(--blue)",textDecoration:"none",fontWeight:500}}>{c.phone}</a>
                          <CopyBtn text={c.phone}/>
                        </div>}
                        {c.email&&<div style={{display:"flex",alignItems:"center",gap:6}}>
                          <span style={{fontSize:11,color:"var(--t3)"}}>✉️</span>
                          <a href={`mailto:${c.email}`} style={{fontSize:11,color:"var(--blue)",textDecoration:"none",fontWeight:500,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{c.email}</a>
                          <CopyBtn text={c.email}/>
                        </div>}
                      </div>
                      {c.notes&&<div style={{marginTop:8,fontSize:10,color:"var(--t3)",lineHeight:1.5,borderTop:"1px solid var(--bd)",paddingTop:8}}>{c.notes}</div>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>}

          {/* DOCUMENTS TAB */}
          {tab==="docs"&&<>
            <div style={{display:"flex",justifyContent:"flex-end",marginBottom:12}}>
              <button className="btn-dark" onClick={()=>setShowAddDoc(true)}>+ Upload Document</button>
            </div>

            {curDocs.length===0&&!showAddDoc&&(
              <div style={{background:"var(--white)",border:"2px dashed var(--bd2)",borderRadius:14,padding:"48px 24px",textAlign:"center"}}>
                <div style={{fontSize:32,opacity:.15,marginBottom:12}}>📁</div>
                <div style={{fontSize:14,fontWeight:600,color:"var(--t3)",marginBottom:6}}>No documents uploaded for this property</div>
                <div style={{fontSize:12,color:"var(--t4)",marginBottom:16}}>Upload loan agreements, appraisals, title policies, and more.</div>
                <button className="btn-dark" onClick={()=>setShowAddDoc(true)}>+ Upload First Document</button>
              </div>
            )}

            {/* Upload form */}
            {showAddDoc&&(
              <div style={{background:"var(--white)",border:"1px solid var(--bd)",borderRadius:14,padding:"20px",marginBottom:14,boxShadow:"0 4px 16px rgba(0,0,0,.07)"}}>
                <div style={{fontSize:13,fontWeight:700,color:"var(--t1)",marginBottom:14}}>Upload Document</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
                  <div>
                    <div className="flbl" style={{display:"block",marginBottom:4}}>Category</div>
                    <select className="finp" value={nd.category} onChange={e=>setNd(p=>({...p,category:e.target.value}))}>
                      {DOC_CATS.map(c=><option key={c}>{c}</option>)}
                    </select>
                  </div>
                  <div>
                    <div className="flbl" style={{display:"block",marginBottom:4}}>Document Name *</div>
                    <input className="finp" placeholder="e.g. Loan Agreement 2024" value={nd.name} onChange={e=>setNd(p=>({...p,name:e.target.value}))}/>
                  </div>
                  <div>
                    <div className="flbl" style={{display:"block",marginBottom:4}}>Date</div>
                    <input className="finp" type="date" value={nd.date} onChange={e=>setNd(p=>({...p,date:e.target.value}))}/>
                  </div>
                  <div>
                    <div className="flbl" style={{display:"block",marginBottom:4}}>File</div>
                    <input type="file" onChange={handleFile} accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.png,.jpg,.jpeg,.txt"
                      style={{width:"100%",padding:"6px 0",fontSize:11,color:"var(--t2)"}}/>
                    {uploading&&<div style={{fontSize:10,color:"var(--blue)",marginTop:4}}>Reading file…</div>}
                    {nd.fileName&&!uploading&&<div style={{fontSize:10,color:"var(--green)",marginTop:4}}>✓ {nd.fileName} ({fSize(nd.fileSize)})</div>}
                  </div>
                  <div style={{gridColumn:"span 2"}}>
                    <div className="flbl" style={{display:"block",marginBottom:4}}>Notes</div>
                    <textarea className="notes-ta" rows={2} placeholder="Brief description or key details…" value={nd.notes} onChange={e=>setNd(p=>({...p,notes:e.target.value}))}/>
                  </div>
                </div>
                <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
                  <button className="btn-light" onClick={()=>{setShowAddDoc(false);setNd(blankD);}}>Cancel</button>
                  <button className="btn-dark" onClick={addDoc} disabled={!nd.name||uploading}>{uploading?"Reading…":"Save Document"}</button>
                </div>
              </div>
            )}

            {/* Doc list grouped by category */}
            {(()=>{
              const grouped={};
              curDocs.forEach(d=>{(grouped[d.category]=grouped[d.category]||[]).push(d);});
              return Object.entries(grouped).map(([cat,docs])=>(
                <div key={cat} style={{marginBottom:16}}>
                  <div style={{fontSize:10,fontWeight:700,color:"var(--t3)",textTransform:"uppercase",letterSpacing:".07em",marginBottom:8,paddingLeft:2}}>{cat}</div>
                  <div style={{display:"flex",flexDirection:"column",gap:7}}>
                    {docs.map(d=>(
                      <div key={d.id} style={{background:"var(--white)",border:"1px solid var(--bd)",borderRadius:10,padding:"13px 16px",display:"flex",alignItems:"center",gap:14}}>
                        <div style={{fontSize:24,flexShrink:0,opacity:.8}}>{fileIcon(d.fileType)}</div>
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{fontSize:13,fontWeight:700,color:"var(--t1)",marginBottom:2}}>{d.name}</div>
                          <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}>
                            {d.date&&<span style={{fontSize:10,color:"var(--t3)"}}>{fDateF(d.date)}</span>}
                            {d.fileName&&<span style={{fontSize:10,color:"var(--t4)"}}>· {d.fileName}</span>}
                            {d.fileSize&&<span style={{fontSize:10,color:"var(--t4)"}}>· {fSize(d.fileSize)}</span>}
                            <span style={{fontSize:9,fontWeight:600,padding:"1px 7px",borderRadius:10,background:"var(--bg)",border:"1px solid var(--bd)",color:"var(--t3)"}}>{cat}</span>
                          </div>
                          {d.notes&&<div style={{fontSize:10,color:"var(--t3)",marginTop:5,lineHeight:1.5}}>{d.notes}</div>}
                        </div>
                        <div style={{display:"flex",gap:6,flexShrink:0}}>
                          {d.fileData&&<button onClick={()=>downloadDoc(d)} style={{padding:"5px 12px",background:"var(--bbg)",border:"1px solid var(--bbd)",borderRadius:7,color:"var(--blue)",fontSize:11,fontWeight:600,cursor:"pointer"}}>⬇ Download</button>}
                          <button onClick={()=>delDoc(d.id)} style={{padding:"5px 10px",background:"var(--rbg)",border:"1px solid var(--rbd)",borderRadius:7,color:"var(--red)",fontSize:11,fontWeight:600,cursor:"pointer"}}>✕</button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ));
            })()}
          </>}
        </>}
      </div>
    </div>
  </div>);
}

/* ─────────── MATURITY WALL CHART ─────────── */
function MaturityWallChart({matSummary}){
  const [hovered,setHovered]=useState(null);
  if(!matSummary||matSummary.length===0)return(
    <div style={{padding:"40px",textAlign:"center",background:"var(--white)",border:"1px solid var(--bd)",borderRadius:16,marginBottom:28}}>
      <div style={{fontSize:32,opacity:.2,marginBottom:12}}>📅</div>
      <div style={{fontSize:14,fontWeight:700,color:"var(--t3)"}}>No maturity dates to display</div>
      <div style={{fontSize:12,color:"var(--t3)",marginTop:4}}>Add maturity dates to your loans to see the maturity wall chart.</div>
    </div>
  );
  const maxBal=Math.max(...matSummary.map(x=>x[1].bal),1);
  const totalBal=Math.max(1,matSummary.reduce((s,[,d])=>s+d.bal,0));
  const n=matSummary.length;
  const W=800,H=240,PAD={t:24,r:24,b:56,l:76};
  const chartW=W-PAD.l-PAD.r,chartH=H-PAD.t-PAD.b;
  const gap=10,barW=(chartW-(n-1)*gap)/n;
  const yTicks=[0,0.25,0.5,0.75,1];
  const getColor=yr=>{
    if(yr<=2026)return{fill:"url(#grad-red)",stroke:"#dc2626",label:"#dc2626"};
    if(yr<=2028)return{fill:"url(#grad-amber)",stroke:"#d97706",label:"#d97706"};
    return{fill:"url(#grad-slate)",stroke:"#64748b",label:"#64748b"};
  };
  return(
  <div style={{marginBottom:28}}>
    <div style={{display:"flex",alignItems:"flex-end",justifyContent:"space-between",marginBottom:14}}>
      <div>
        <div style={{fontSize:15,fontWeight:700,color:"var(--t1)"}}>Maturity Wall</div>
        <div style={{fontSize:11,color:"var(--t3)",marginTop:2}}>{f$(totalBal)} total debt · {n} maturity years</div>
      </div>
      <div style={{display:"flex",gap:14,alignItems:"center"}}>
        {[{c:"#dc2626",l:"2026 — Urgent"},{c:"#d97706",l:"2027–28 — Near-term"},{c:"#64748b",l:"2029+ — Long-term"}].map(item=>(
          <div key={item.c} style={{display:"flex",alignItems:"center",gap:5,fontSize:10,color:"var(--t3)"}}>
            <div style={{width:10,height:10,borderRadius:3,background:item.c,opacity:.8}}/>
            {item.l}
          </div>
        ))}
      </div>
    </div>
    <div style={{background:"var(--white)",border:"1px solid var(--bd)",borderRadius:16,overflow:"visible",boxShadow:"0 1px 6px rgba(0,0,0,.05)"}}>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{display:"block",overflow:"visible"}}>
        <defs>
          <linearGradient id="grad-red" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f87171" stopOpacity="1"/>
            <stop offset="100%" stopColor="#dc2626" stopOpacity="0.9"/>
          </linearGradient>
          <linearGradient id="grad-amber" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#fbbf24" stopOpacity="1"/>
            <stop offset="100%" stopColor="#d97706" stopOpacity="0.9"/>
          </linearGradient>
          <linearGradient id="grad-slate" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#94a3b8" stopOpacity="1"/>
            <stop offset="100%" stopColor="#475569" stopOpacity="0.9"/>
          </linearGradient>
          <filter id="glow-red"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
          <filter id="shadow"><feDropShadow dx="0" dy="3" stdDeviation="4" floodOpacity="0.14"/></filter>
        </defs>

        {/* Background subtle fill for chart area */}
        <rect x={PAD.l} y={PAD.t} width={chartW} height={chartH} fill="#fafafa" rx={4}/>

        {/* Grid lines + Y labels */}
        {yTicks.map(pct=>{
          const y=PAD.t+chartH*(1-pct);
          return(
            <g key={pct}>
              <line x1={PAD.l} y1={y} x2={PAD.l+chartW} y2={y}
                stroke={pct===0?"#cbd5e1":"#e2e8f0"} strokeWidth={pct===0?1.5:1}
                strokeDasharray={pct===0?"":"5 4"}/>
              <text x={PAD.l-10} y={y+4} textAnchor="end" fontSize="10" fill="#94a3b8" fontFamily="'Inter',sans-serif">{f$(maxBal*pct)}</text>
            </g>
          );
        })}

        {/* Bars */}
        {matSummary.map(([y,d],i)=>{
          const yr=parseInt(y);
          const x=PAD.l+i*(barW+gap);
          const bh=Math.max(8,(d.bal/maxBal)*chartH);
          const by=PAD.t+chartH-bh;
          const clr=getColor(yr);
          const isHov=hovered===y;
          const pct=(d.bal/totalBal*100).toFixed(1);
          const hovBg=yr<=2026?"#fff5f5":yr<=2028?"#fffbf0":"#f8fafc";
          return(
            <g key={y} onMouseEnter={()=>setHovered(y)} onMouseLeave={()=>setHovered(null)} style={{cursor:"default"}}>
              {/* Hover column highlight */}
              {isHov&&<rect x={x-5} y={PAD.t} width={barW+10} height={chartH} rx={6} fill={hovBg} opacity={0.9}/>}
              {/* Bar shadow */}
              {isHov&&<rect x={x+2} y={by+4} width={barW} height={bh} rx={6} fill={clr.stroke} opacity={0.15}/>}
              {/* Main bar */}
              <rect x={x} y={by} width={barW} height={bh} rx={6} ry={6}
                fill={clr.fill}
                style={{transition:"all .2s"}}/>
              {/* Bright top strip */}
              <rect x={x} y={by} width={barW} height={5} rx={3} fill="white" opacity={0.25}/>
              {/* Loan count inside bar */}
              {bh>40&&(
                <text x={x+barW/2} y={by+bh-12} textAnchor="middle" fontSize="10" fontWeight="700"
                  fill="white" opacity="0.95" fontFamily="'Inter',sans-serif">
                  {d.count} loan{d.count>1?"s":""}
                </text>
              )}
              {/* Value above bar */}
              <text x={x+barW/2} y={by-7} textAnchor="middle" fontSize="10" fontWeight="700"
                fill={clr.label} fontFamily="'Inter',sans-serif" opacity={isHov?1:0.85}>
                {f$(d.bal)}
              </text>
              {/* Tooltip on hover */}
              {isHov&&(()=>{
                const tx=Math.min(Math.max(x+barW/2,90),W-90);
                const ty=Math.max(by-60,2);
                return(
                  <g style={{pointerEvents:"none"}}>
                    <rect x={tx-60} y={ty} width={120} height={46} rx={8} fill="#0f172a" opacity={0.93}/>
                    <text x={tx} y={ty+16} textAnchor="middle" fontSize="11" fontWeight="700" fill="white" fontFamily="'Inter',sans-serif">{y} — {f$(d.bal)}</text>
                    <text x={tx} y={ty+30} textAnchor="middle" fontSize="10" fill="#94a3b8" fontFamily="'Inter',sans-serif">{d.count} loan{d.count>1?"s":""} · {pct}% of portfolio</text>
                  </g>
                );
              })()}
              {/* X label year */}
              <text x={x+barW/2} y={PAD.t+chartH+18} textAnchor="middle" fontSize="12" fontWeight="700"
                fill={clr.label} fontFamily="'Inter',sans-serif">{y}</text>
              {/* X label loan count */}
              <text x={x+barW/2} y={PAD.t+chartH+33} textAnchor="middle" fontSize="9" fill="#94a3b8" fontFamily="'Inter',sans-serif">
                {d.count} loan{d.count>1?"s":""}
              </text>
            </g>
          );
        })}

        {/* Y-axis line */}
        <line x1={PAD.l} y1={PAD.t} x2={PAD.l} y2={PAD.t+chartH} stroke="#e2e8f0" strokeWidth={1}/>
      </svg>
    </div>
  </div>
  );
}

function MaturityTimeline({loans,onSelect}){
  const en=useMemo(()=>loans.map(enrich),[loans]);
  const TLS=2024,TLE=2033,SPAN=TLE-TLS;
  const todayFrac=(2026+(1/12)-TLS)/SPAN;
  const sorted=[...en].sort((a,b)=>(a.daysLeft??99999)-(b.daysLeft??99999));
  const tb=en.reduce((s,l)=>s+l.curBal,0);
  const yrs=Array.from({length:TLE-TLS+1},(_,i)=>TLS+i);

  const barColor=l=>{
    if(l.loanType==="Bridge")return{bg:"#fef3c7",border:"#fde68a",txt:"#92400e"};
    if(l.status==="matured"||l.status==="urgent")return{bg:"#fef2f2",border:"#fecaca",txt:"#991b1b"};
    if(l.status==="soon")return{bg:"#fffbeb",border:"#fde68a",txt:"#92400e"};
    return{bg:"#f0fdf4",border:"#bbf7d0",txt:"#166534"};
  };
  const dotColor=l=>{
    if(l.loanType==="Bridge")return"#d97706";
    if(l.status==="matured"||l.status==="urgent")return"#dc2626";
    if(l.status==="soon")return"#d97706";
    return"#16a34a";
  };

  function barPos(l){
    const od=l.origDate?new Date(l.origDate):new Date("2020-01-01");
    const md=l.maturityDate?new Date(l.maturityDate):new Date("2030-01-01");
    const os=Math.max(0,(od.getFullYear()+(od.getMonth()/12)-TLS)/SPAN);
    const ms=Math.min(1,(md.getFullYear()+(md.getMonth()/12)-TLS)/SPAN);
    return{left:`${os*100}%`,width:`${Math.max(0.8,(ms-os)*100)}%`};
  }

  // Group maturities by year for summary
  const byYear={};
  en.forEach(l=>{if(!l.maturityDate)return;const y=new Date(l.maturityDate).getFullYear();if(isNaN(y))return;if(!byYear[y])byYear[y]={count:0,bal:0,urgent:0};byYear[y].count++;byYear[y].bal+=l.curBal;if(l.status==="urgent"||l.status==="matured")byYear[y].urgent++;});
  const matSummary=Object.entries(byYear).sort((a,b)=>a[0]-b[0]);

  return(<div>
    <div style={{marginBottom:20}}>
      <div style={{fontSize:22,fontWeight:700,color:"var(--t1)",marginBottom:4}}>Maturity Timeline</div>
      <div style={{fontSize:13,color:"var(--t3)"}}>Visual map of all {loans.length} loans from origination to maturity. Click any bar to open the loan.</div>
    </div>

    {/* Summary row */}
    <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:20}}>
      <div className="scard"><div className="sc-lbl">Past / Urgent</div><div className="sc-val red">{en.filter(l=>l.status==="matured"||l.status==="urgent").length}</div><div className="sc-sub">within 6 months</div></div>
      <div className="scard"><div className="sc-lbl">Maturing ≤12mo</div><div className="sc-val amber">{en.filter(l=>l.status==="soon").length}</div><div className="sc-sub">6–12 months</div></div>
      <div className="scard"><div className="sc-lbl">Long-Term</div><div className="sc-val green">{en.filter(l=>l.status==="ok").length}</div><div className="sc-sub">&gt;12 months</div></div>
      <div className="scard"><div className="sc-lbl">Bridge Loans</div><div className="sc-val amber">{en.filter(l=>l.loanType==="Bridge").length}</div><div className="sc-sub">short-term / IO</div></div>
    </div>

    {/* Maturity wall chart */}
    <MaturityWallChart matSummary={matSummary}/>

    {/* Legend */}
    <div style={{display:"flex",gap:16,marginBottom:10,marginLeft:200}}>
      {[{c:"#dc2626",l:"Urgent / Past"},{c:"#d97706",l:"Within 12mo"},{c:"#16a34a",l:"Long-term"},{c:"#d97706",l:"Bridge",border:"#fde68a"}].map((item,i)=>(
        <div key={i} style={{display:"flex",alignItems:"center",gap:5,fontSize:10,color:"var(--t3)"}}>
          <div style={{width:10,height:10,borderRadius:2,background:item.c,opacity:.6}}/>
          {item.l}
        </div>
      ))}
    </div>

    {/* Year header */}
    <div style={{display:"flex",paddingLeft:200,marginBottom:4,paddingBottom:6,borderBottom:"1px solid var(--bd)"}}>
      {yrs.map(y=>(
        <div key={y} style={{flex:1,fontSize:9,fontWeight:600,color:"var(--t3)",textAlign:"left",letterSpacing:".04em"}}>{y}</div>
      ))}
    </div>

    {/* Bars */}
    <div style={{background:"var(--white)",border:"1px solid var(--bd)",borderRadius:12,overflow:"hidden"}}>
      {sorted.map((l,i)=>{
        const pos=barPos(l);
        const bc=barColor(l);
        const dc=dotColor(l);
        return(
          <div key={l.id}
            onClick={()=>onSelect(loans.find(x=>x.id===l.id))}
            style={{display:"flex",alignItems:"center",height:38,padding:"0 4px",cursor:"pointer",borderBottom:i<sorted.length-1?"1px solid var(--bd)":"none",transition:"background .1s"}}
            onMouseEnter={e=>e.currentTarget.style.background="var(--bg)"}
            onMouseLeave={e=>e.currentTarget.style.background="transparent"}
          >
            {/* Label */}
            <div style={{width:196,flexShrink:0,paddingRight:8}}>
              <div style={{fontSize:10,fontWeight:600,color:"var(--t1)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",display:"flex",alignItems:"center",gap:5}}>
                <div style={{width:6,height:6,borderRadius:"50%",background:dc,flexShrink:0}}/>
                {l.addr}
              </div>
              <div style={{fontSize:9,color:"var(--t3)",marginTop:1,paddingLeft:11}}>{f$(l.curBal)} · {fPct(l.rate)}</div>
            </div>

            {/* Chart area */}
            <div style={{flex:1,position:"relative",height:"100%",display:"flex",alignItems:"center"}}>
              {/* Today line */}
              <div style={{position:"absolute",left:`${todayFrac*100}%`,top:-2,bottom:-2,width:1,background:"#dc2626",opacity:.4,pointerEvents:"none",zIndex:2}}/>
              {/* Bar */}
              <div style={{position:"absolute",...pos,height:22,borderRadius:4,background:bc.bg,border:`1px solid ${bc.border}`,display:"flex",alignItems:"center",padding:"0 6px",overflow:"hidden",zIndex:1}}>
                <div style={{fontSize:8,fontWeight:600,color:bc.txt,whiteSpace:"nowrap",overflow:"hidden"}}>{fDateS(l.maturityDate)}</div>
              </div>
            </div>
          </div>
        );
      })}
    </div>

    {/* "Today" label */}
    <div style={{display:"flex",paddingLeft:200,marginTop:6}}>
      <div style={{position:"relative",flex:1}}>
        <div style={{position:"absolute",left:`${todayFrac*100}%`,transform:"translateX(-50%)",fontSize:9,fontWeight:700,color:"#dc2626",whiteSpace:"nowrap"}}>▲ Today Feb 2026</div>
      </div>
    </div>
  </div>);
}

/* ─────────── LOAN MATURITY SCHEDULE ─────────── */
function LoanMaturitySchedule({loans,onSelect}){
  const en=useMemo(()=>loans.map(enrich),[loans]);
  const [viewMode,setViewMode]=useState("table");
  const [filterYr,setFilterYr]=useState("ALL");
  const [filterStatus,setFilterStatus]=useState("ALL");
  const [filterLender,setFilterLender]=useState("ALL");
  const [sort,setSort]=useState({col:"daysLeft",dir:1});
  const [search,setSearch]=useState("");

  const years=[...new Set(en.filter(l=>l.maturityDate).map(l=>new Date(l.maturityDate).getFullYear()))].sort();
  const lenders=[...new Set(en.map(l=>l.lender).filter(Boolean))].sort();
  const filtered=en.filter(l=>{
    const yr=filterYr==="ALL"||( l.maturityDate && new Date(l.maturityDate).getFullYear()===parseInt(filterYr));
    const st=filterStatus==="ALL"||l.status===filterStatus;
    const ln=filterLender==="ALL"||l.lender===filterLender;
    const sr=!search||l.addr.toLowerCase().includes(search.toLowerCase())||l.lender.toLowerCase().includes(search.toLowerCase());
    return yr&&st&&ln&&sr;
  });
  const sorted=[...filtered].sort((a,b)=>{
    const av=a[sort.col]??Infinity, bv=b[sort.col]??Infinity;
    return(av>bv?1:av<bv?-1:0)*sort.dir;
  });

  const setS=col=>setSort(s=>({col,dir:s.col===col?-s.dir:1}));
  const arrow=col=>sort.col===col?(sort.dir===1?"↑":"↓"):"";

  // Group by year for the visual timeline view
  const byYear={};
  en.forEach(l=>{
    const y=new Date(l.maturityDate).getFullYear();
    if(!byYear[y])byYear[y]={loans:[],totalBal:0};
    byYear[y].loans.push(l);
    byYear[y].totalBal+=l.curBal;
  });

  const totalPortfolio=en.reduce((s,l)=>s+l.curBal,0);

  // Status styling
  const stMeta=s=>({
    matured:{label:"Matured",color:"#dc2626",bg:"#fef2f2",bd:"#fecaca"},
    urgent: {label:"< 6 mo",color:"#dc2626",bg:"#fef2f2",bd:"#fecaca"},
    soon:   {label:"6–12 mo",color:"#d97706",bg:"#fffbeb",bd:"#fde68a"},
    ok:     {label:"12+ mo",color:"#16a34a",bg:"#f0fdf4",bd:"#bbf7d0"},
  }[s]||{label:s,color:"#64748b",bg:"#f8fafc",bd:"#e2e8f0"});

  const urgentCount=en.filter(l=>l.status==="urgent"||l.status==="matured").length;
  const soonCount=en.filter(l=>l.status==="soon").length;
  const okCount=en.filter(l=>l.status==="ok").length;
  const urgentBal=en.filter(l=>l.status==="urgent"||l.status==="matured").reduce((s,l)=>s+l.curBal,0);

  return(<div>
    {/* Header */}
    <div style={{marginBottom:20}}>
      <div style={{fontSize:22,fontWeight:700,color:"var(--t1)",marginBottom:4}}>Loan Maturity Schedule</div>
      <div style={{fontSize:13,color:"var(--t3)"}}>Every loan sorted by maturity date with days remaining, prepay exposure, and action flags.</div>
    </div>

    {/* KPIs */}
    <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:20}}>
      <div style={{background:"var(--white)",border:"2px solid var(--rbd)",borderRadius:12,padding:"14px 16px"}}>
        <div style={{fontSize:9,fontWeight:700,color:"var(--red)",textTransform:"uppercase",letterSpacing:".07em",marginBottom:7}}>🔴 Urgent / Matured</div>
        <div style={{fontSize:26,fontWeight:700,color:"var(--red)",lineHeight:1,marginBottom:4}}>{urgentCount}</div>
        <div style={{fontSize:11,color:"var(--red)",fontWeight:500}}>{f$(urgentBal)} at risk</div>
      </div>
      <div style={{background:"var(--white)",border:"1px solid var(--abd)",borderRadius:12,padding:"14px 16px"}}>
        <div style={{fontSize:9,fontWeight:700,color:"var(--amber)",textTransform:"uppercase",letterSpacing:".07em",marginBottom:7}}>🟡 Maturing Soon</div>
        <div style={{fontSize:26,fontWeight:700,color:"var(--amber)",lineHeight:1,marginBottom:4}}>{soonCount}</div>
        <div style={{fontSize:11,color:"var(--t3)"}}>within 12 months</div>
      </div>
      <div style={{background:"var(--white)",border:"1px solid var(--bd)",borderRadius:12,padding:"14px 16px"}}>
        <div style={{fontSize:9,fontWeight:700,color:"var(--green)",textTransform:"uppercase",letterSpacing:".07em",marginBottom:7}}>✅ Long-term</div>
        <div style={{fontSize:26,fontWeight:700,color:"var(--green)",lineHeight:1,marginBottom:4}}>{okCount}</div>
        <div style={{fontSize:11,color:"var(--t3)"}}>12+ months remaining</div>
      </div>
      <div style={{background:"var(--white)",border:"1px solid var(--bd)",borderRadius:12,padding:"14px 16px"}}>
        <div style={{fontSize:9,fontWeight:700,color:"var(--t3)",textTransform:"uppercase",letterSpacing:".07em",marginBottom:7}}>Total Loan Count</div>
        <div style={{fontSize:26,fontWeight:700,color:"var(--t1)",lineHeight:1,marginBottom:4}}>{en.length}</div>
        <div style={{fontSize:11,color:"var(--t3)"}}>{f$(totalPortfolio)} total balance</div>
      </div>
    </div>

    {/* Controls */}
    <div style={{marginBottom:14,display:"flex",flexDirection:"column",gap:8}}>
      {/* Row 1: search + view toggle + export */}
      <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
        <input className="f-inp" placeholder="Search address or lender…" value={search} onChange={e=>setSearch(e.target.value)} style={{maxWidth:220}}/>
        <div style={{flex:1}}/>
        <button className="btn-light" style={{fontSize:11}} onClick={()=>downloadCSV("maturity-schedule.csv",
          ["Address","Lender","Balance","Rate","Type","Maturity Date","Days Left","Status","Prepay","Refi Status"],
          sorted.map(l=>[l.addr,l.lender,l.curBal.toFixed(0),l.rate,l.loanType,l.maturityDate||"",l.daysLeft!=null?l.daysLeft:"",l.status,l.prepay||"",l.refiStatus||""])
        )}>⬇ Export CSV</button>
        <div style={{display:"flex",gap:2,background:"var(--white)",border:"1px solid var(--bd)",borderRadius:8,padding:2}}>
          {[["table","📋 Table"],["timeline","🗓 Year View"]].map(([id,lbl])=>(
            <button key={id} onClick={()=>setViewMode(id)} style={{
              padding:"5px 14px",borderRadius:6,border:"none",fontSize:11,fontWeight:viewMode===id?700:400,
              background:viewMode===id?"var(--t1)":"transparent",color:viewMode===id?"var(--white)":"var(--t3)",cursor:"pointer",
            }}>{lbl}</button>
          ))}
        </div>
      </div>
      {/* Row 2: filter pills */}
      <div className="frow" style={{flexWrap:"wrap",gap:5}}>
        <span style={{fontSize:10,color:"var(--t3)",alignSelf:"center",fontWeight:600}}>STATUS:</span>
        {[["ALL","All"],["matured","⚫ Matured"],["urgent","🔴 Urgent"],["soon","🟡 Soon"],["ok","✅ Long-term"],["unknown","No Date"]].map(([id,lbl])=>(
          <button key={id} className={`fb${filterStatus===id?" fa":""}`} onClick={()=>setFilterStatus(id)}>{lbl}</button>
        ))}
        <span style={{fontSize:10,color:"var(--t3)",alignSelf:"center",fontWeight:600,marginLeft:8}}>YEAR:</span>
        {["ALL",...years.map(String)].map(y=>(
          <button key={y} className={`fb${filterYr===y?" fa":""}`} onClick={()=>setFilterYr(y)}>{y==="ALL"?"All Years":y}</button>
        ))}
        <span style={{fontSize:10,color:"var(--t3)",alignSelf:"center",fontWeight:600,marginLeft:8}}>SORT:</span>
        {[["daysLeft","Days Left"],["curBal","Balance ↕"],["rate","Rate ↕"],["maturityDate","Maturity Date"],["addr","A–Z"],["lender","Lender"]].map(([k,lbl])=>(
          <button key={k} className={`fb${sort.col===k?" fa":""}`} onClick={()=>setSort(s=>({col:k,dir:s.col===k?-s.dir:1}))}>{lbl}{sort.col===k?(sort.dir===1?" ↑":" ↓"):""}</button>
        ))}
        <span style={{fontSize:10,color:"var(--t3)",alignSelf:"center",fontWeight:600,marginLeft:8}}>LENDER:</span>
        <select style={{fontSize:11,padding:"4px 8px",borderRadius:6,border:"1px solid var(--bd)",background:"var(--white)",color:"var(--t2)",cursor:"pointer"}}
          value={filterLender} onChange={e=>setFilterLender(e.target.value)}>
          <option value="ALL">All Lenders</option>
          {lenders.map(l=><option key={l} value={l}>{l}</option>)}
        </select>
        <span style={{fontSize:10,color:"var(--t4)",alignSelf:"center",marginLeft:8}}>{sorted.length} of {en.length} loans</span>
      </div>
    </div>

    {/* ─── TABLE VIEW ─── */}
    {viewMode==="table"&&<>
      <div style={{fontSize:10,color:"var(--t3)",marginBottom:8,fontWeight:500}}>{sorted.length} loan{sorted.length!==1?"s":""} · click column headers to sort · click row to open</div>
      <div className="tbl-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th onClick={()=>setS("addr")} style={{cursor:"pointer",userSelect:"none"}}>Address {arrow("addr")}</th>
              <th onClick={()=>setS("lender")} style={{cursor:"pointer",userSelect:"none"}}>Lender {arrow("lender")}</th>
              <th onClick={()=>setS("curBal")} style={{cursor:"pointer",userSelect:"none"}}>Balance {arrow("curBal")}</th>
              <th onClick={()=>setS("rate")} style={{cursor:"pointer",userSelect:"none"}}>Rate {arrow("rate")}</th>
              <th onClick={()=>setS("maturityDate")} style={{cursor:"pointer",userSelect:"none"}}>Maturity Date {arrow("maturityDate")}</th>
              <th onClick={()=>setS("daysLeft")} style={{cursor:"pointer",userSelect:"none"}}>Days Left {arrow("daysLeft")}</th>
              <th>Status</th>
              <th>Prepay</th>
              <th>Refi Status</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((l,i)=>{
              const m=stMeta(l.status);
              const isUrgent=l.status==="urgent"||l.status==="matured";
              return(
                <tr key={l.id} onClick={()=>onSelect(loans.find(x=>x.id===l.id))}
                  style={{background:isUrgent?"var(--rbg)":i%2===0?"var(--white)":"var(--bg)"}}>
                  <td>
                    <div style={{display:"flex",alignItems:"center",gap:8}}>
                      {isUrgent&&<div style={{width:3,height:36,borderRadius:2,background:"var(--red)",flexShrink:0}}/>}
                      <div>
                        <div className="td-a">{l.addr}</div>
                        <div className="td-b">{l.entity||"—"}</div>
                      </div>
                    </div>
                  </td>
                  <td><span style={{fontSize:12,color:"var(--t2)"}}>{l.lender}</span></td>
                  <td><span className="td-n">{f$(l.curBal)}</span></td>
                  <td><span className={`td-n${l.rate>7?" red":l.rate>5?" amber":" green"}`}>{fPct(l.rate)}</span></td>
                  <td>
                    <div style={{fontSize:12,fontWeight:600,color:"var(--t1)"}}>{fDateF(l.maturityDate)}</div>
                    <div style={{fontSize:10,color:"var(--t3)",marginTop:1}}>{new Date(l.maturityDate).getFullYear()}</div>
                  </td>
                  <td>
                    <div style={{
                      fontSize:16,fontWeight:700,
                      color:l.daysLeft<0?"var(--red)":l.daysLeft<180?"var(--red)":l.daysLeft<365?"var(--amber)":"var(--t1)",
                    }}>
                      {l.daysLeft<0?`${Math.abs(l.daysLeft)}d over`:l.daysLeft!=null?`${l.daysLeft}d`:""}
                    </div>
                    <div style={{fontSize:9,color:"var(--t3)",marginTop:1}}>
                      {l.daysLeft!=null?`${Math.abs(Math.round(l.daysLeft/30))} mo ${l.daysLeft<0?"past":"left"}`:""}
                    </div>
                  </td>
                  <td>
                    <span style={{
                      display:"inline-block",padding:"3px 10px",borderRadius:20,fontSize:10,fontWeight:700,
                      background:m.bg,color:m.color,border:`1px solid ${m.bd}`,
                    }}>{m.label}</span>
                  </td>
                  <td><span style={{fontSize:11,color:"var(--t3)",maxWidth:120,display:"inline-block"}}>{l.prepay||"None"}</span></td>
                  <td>
                    {(()=>{
                      const rs=l.refiStatus||"Not Started";
                      const rc=rs==="Closed"?"var(--green)":rs==="Not Started"?"var(--t4)":"var(--blue)";
                      return<span style={{fontSize:10,color:rc,fontWeight:600}}>{rs}</span>;
                    })()}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>}

    {/* ─── YEAR VIEW ─── */}
    {viewMode==="timeline"&&(
      <div style={{display:"flex",flexDirection:"column",gap:16}}>
        {Object.entries(byYear).filter(([y])=>filterYr==="ALL"||y===filterYr).sort(([a],[b])=>a-b).map(([year,data])=>{
          const yr=parseInt(year);
          const isNow=yr===2026;
          const isPast=yr<2026;
          const pct=(data.totalBal/totalPortfolio*100).toFixed(1);
          const yMeta=isPast?{accent:"#dc2626",bg:"var(--rbg)",bd:"var(--rbd)"}:
                       isNow?{accent:"#dc2626",bg:"var(--rbg)",bd:"var(--rbd)"}:
                       yr===2027||yr===2028?{accent:"#d97706",bg:"var(--abg)",bd:"var(--abd)"}:
                       {accent:"#16a34a",bg:"var(--gbg)",bd:"var(--gbd)"};
          return(
            <div key={year} style={{border:`1px solid ${yMeta.bd}`,borderRadius:14,overflow:"hidden",boxShadow:"0 1px 4px rgba(0,0,0,.04)"}}>
              {/* Year header */}
              <div style={{
                padding:"14px 20px",background:yMeta.bg,
                borderBottom:`1px solid ${yMeta.bd}`,
                display:"flex",alignItems:"center",justifyContent:"space-between",
              }}>
                <div style={{display:"flex",alignItems:"center",gap:14}}>
                  <div style={{width:4,height:36,borderRadius:2,background:yMeta.accent,flexShrink:0}}/>
                  <div>
                    <div style={{fontSize:20,fontWeight:800,color:yMeta.accent,lineHeight:1}}>{year}</div>
                    <div style={{fontSize:11,color:"var(--t3)",marginTop:2}}>{data.loans.length} loan{data.loans.length>1?"s":""} maturing</div>
                  </div>
                </div>
                <div style={{textAlign:"right"}}>
                  <div style={{fontSize:18,fontWeight:700,color:"var(--t1)"}}>{f$(data.totalBal)}</div>
                  <div style={{fontSize:10,color:"var(--t3)",marginTop:1}}>{pct}% of portfolio · due this year</div>
                  {/* Mini bar */}
                  <div style={{width:140,height:4,borderRadius:2,background:"var(--bd2)",marginTop:6,marginLeft:"auto"}}>
                    <div style={{width:`${Math.min(100,parseFloat(pct))}%`,height:4,borderRadius:2,background:yMeta.accent}}/>
                  </div>
                </div>
              </div>
              {/* Loan rows */}
              <div style={{background:"var(--white)"}}>
                {data.loans.sort((a,b)=>a.daysLeft-b.daysLeft).map((l,i)=>{
                  const m=stMeta(l.status);
                  const isLast=i===data.loans.length-1;
                  return(
                    <div key={l.id} onClick={()=>onSelect(loans.find(x=>x.id===l.id))}
                      style={{
                        display:"flex",alignItems:"center",gap:16,
                        padding:"14px 20px",
                        borderBottom:isLast?"none":"1px solid var(--bd)",
                        cursor:"pointer",transition:"background .1s",
                      }}
                      onMouseEnter={e=>e.currentTarget.style.background="var(--bg)"}
                      onMouseLeave={e=>e.currentTarget.style.background="var(--white)"}
                    >
                      {/* Status dot */}
                      <div style={{width:10,height:10,borderRadius:"50%",background:m.color,flexShrink:0}}/>
                      {/* Address */}
                      <div style={{flex:2,minWidth:0}}>
                        <div style={{fontSize:13,fontWeight:700,color:"var(--t1)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{l.addr}</div>
                        <div style={{fontSize:10,color:"var(--t3)",marginTop:1}}>{l.entity||l.lender}</div>
                      </div>
                      {/* Maturity date */}
                      <div style={{flex:1,textAlign:"center"}}>
                        <div style={{fontSize:12,fontWeight:600,color:"var(--t1)"}}>{fDateF(l.maturityDate)}</div>
                        <div style={{fontSize:10,color:m.color,fontWeight:600,marginTop:1}}>
                          {l.daysLeft<0?`${Math.abs(l.daysLeft)}d overdue`:`${l.daysLeft} days`}
                        </div>
                      </div>
                      {/* Balance */}
                      <div style={{flex:1,textAlign:"right"}}>
                        <div style={{fontSize:14,fontWeight:700,color:"var(--t1)"}}>{f$(l.curBal)}</div>
                        <div style={{fontSize:10,color:"var(--t3)",marginTop:1}}>{fPct(l.rate)} {l.loanType}</div>
                      </div>
                      {/* Status pill */}
                      <div style={{flexShrink:0}}>
                        <span style={{display:"inline-block",padding:"4px 12px",borderRadius:20,fontSize:10,fontWeight:700,background:m.bg,color:m.color,border:`1px solid ${m.bd}`}}>{m.label}</span>
                      </div>
                      {/* Refi status */}
                      <div style={{flexShrink:0,width:100,textAlign:"right"}}>
                        {(()=>{
                          const rs=l.refiStatus||"Not Started";
                          const rc=rs==="Closed"?"var(--green)":rs==="Not Started"?"var(--t4)":"var(--blue)";
                          return<span style={{fontSize:10,color:rc,fontWeight:600}}>{rs}</span>;
                        })()}
                      </div>
                      <div style={{fontSize:12,color:"var(--t4)",flexShrink:0}}>›</div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    )}
  </div>);
}

/* ─────────── LENDER EXPOSURE ─────────── */
function LenderExposure({loans,onSelect}){
  const en=useMemo(()=>loans.map(enrich),[loans]);
  const tb=en.reduce((s,l)=>s+l.curBal,0);

  // By lender
  const byLender={};
  en.forEach(l=>{
    if(!byLender[l.lender])byLender[l.lender]={lender:l.lender,type:l.lenderType,bal:0,count:0,rate:0,loans:[],urgent:0,recourse:0};
    byLender[l.lender].bal+=l.curBal;
    byLender[l.lender].count+=1;
    byLender[l.lender].rate+=l.rate*l.curBal;
    byLender[l.lender].loans.push(l);
    if(l.status==="urgent"||l.status==="matured")byLender[l.lender].urgent+=1;
    if(l.recourse)byLender[l.lender].recourse+=1;
  });
  const lenders=Object.values(byLender).map(r=>({...r,wac:r.rate/r.bal,pct:r.bal/tb*100})).sort((a,b)=>b.bal-a.bal);

  // By lender type
  const byType={};
  en.forEach(l=>{
    if(!byType[l.lenderType])byType[l.lenderType]={type:l.lenderType,bal:0,count:0,rate:0};
    byType[l.lenderType].bal+=l.curBal;
    byType[l.lenderType].count+=1;
    byType[l.lenderType].rate+=l.rate*l.curBal;
  });
  const types=Object.values(byType).map(r=>({...r,wac:r.rate/r.bal,pct:r.bal/tb*100})).sort((a,b)=>b.bal-a.bal);

  // Recourse exposure
  const recBal=en.filter(l=>l.recourse).reduce((s,l)=>s+l.curBal,0);
  const nrBal=en.filter(l=>!l.recourse).reduce((s,l)=>s+l.curBal,0);

  // Maturity concentration
  const byYear={};
  en.forEach(l=>{const y=new Date(l.maturityDate).getFullYear();if(!byYear[y])byYear[y]=0;byYear[y]+=l.curBal;});
  const matYears=Object.entries(byYear).map(([y,b])=>({year:y,bal:b,pct:b/tb*100})).sort((a,b)=>a.year-b.year);
  const maxYrBal=Math.max(...matYears.map(r=>r.bal));

  // Top lender concentration risk
  const topLender=lenders[0];
  const conc=topLender?.pct||0;

  const typeColors={"Agency":"var(--green)","Regional Bank":"var(--blue)","National Bank":"var(--amber)","Life Company":"var(--t1)","Bridge":"var(--red)","Special Servicer":"var(--amber)","CMBS":"var(--blue)","Private / Hard Money":"var(--red)"};

  return(<div>
    <div style={{marginBottom:20}}>
      <div style={{fontSize:22,fontWeight:700,color:"var(--t1)",marginBottom:4}}>Lender Exposure</div>
      <div style={{fontSize:13,color:"var(--t3)"}}>Concentration risk, recourse breakdown, and maturity schedule by lender.</div>
    </div>

    {/* KPI strip */}
    <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:20}}>
      <div className="scard"><div className="sc-lbl">Total Lenders</div><div className="sc-val">{lenders.length}</div><div className="sc-sub">across {loans.length} loans</div></div>
      <div className="scard"><div className="sc-lbl">Top Lender Concentration</div><div className={`sc-val${conc>40?" red":conc>25?" amber":""}`}>{conc.toFixed(1)}%</div><div className="sc-sub">{topLender?.lender}</div></div>
      <div className="scard"><div className="sc-lbl">Recourse Exposure</div><div className="sc-val amber">{f$(recBal)}</div><div className="sc-sub">{(recBal/tb*100).toFixed(1)}% of portfolio</div></div>
      <div className="scard"><div className="sc-lbl">Non-Recourse</div><div className="sc-val green">{f$(nrBal)}</div><div className="sc-sub">{(nrBal/tb*100).toFixed(1)}% of portfolio</div></div>
    </div>

    {conc>30&&<div className="warn-box" style={{marginBottom:16}}>⚠ {topLender?.lender} holds {conc.toFixed(1)}% of total portfolio debt — high concentration risk. Diversify at next refi opportunity.</div>}

    {/* By Lender table */}
    <div style={{marginBottom:20}}>
      <div className="sec-hdr"><div className="sec-t">Exposure by Lender</div><div className="sec-m">SORTED BY BALANCE</div></div>
      <div className="tbl-wrap">
        <table className="tbl">
          <thead><tr><th>Lender</th><th>Type</th><th>Loans</th><th>Balance</th><th>% of Portfolio</th><th>Wtd. Rate</th><th>Recourse</th><th>Urgent</th></tr></thead>
          <tbody>{lenders.map((r,i)=>(
            <tr key={r.lender} style={{cursor:"default"}}>
              <td>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <div style={{width:3,height:32,borderRadius:2,background:typeColors[r.type]||"var(--t3)",flexShrink:0}}/>
                  <div>
                    <div className="td-a">{r.lender}</div>
                    <div className="td-b">{r.count} loan{r.count>1?"s":""}</div>
                  </div>
                </div>
              </td>
              <td><span className="chip chip-grey">{r.type}</span></td>
              <td><span className="td-n">{r.count}</span></td>
              <td><span className="td-n">{f$(r.bal)}</span></td>
              <td>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <div style={{width:80,height:6,background:"var(--bd)",borderRadius:3,overflow:"hidden"}}>
                    <div style={{height:6,borderRadius:3,background:i===0?"var(--amber)":"var(--t1)",width:`${r.pct}%`}}/>
                  </div>
                  <span className={`td-n${r.pct>30?" amber":""}`}>{r.pct.toFixed(1)}%</span>
                </div>
              </td>
              <td><span className={`td-n${r.wac>7?" red":r.wac>5?" amber":" green"}`}>{fPct(r.wac)}</span></td>
              <td><span className={`td-n${r.recourse>0?" amber":""}`}>{r.recourse} / {r.count}</span></td>
              <td>{r.urgent>0?<span className="chip chip-red">{r.urgent} urgent</span>:<span className="td-n muted">—</span>}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </div>

    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:20}}>
      {/* By type */}
      <div>
        <div className="sec-hdr"><div className="sec-t">By Lender Type</div></div>
        <div style={{background:"var(--white)",border:"1px solid var(--bd)",borderRadius:12,padding:"16px 18px"}}>
          {types.map(r=>(
            <div key={r.type} style={{marginBottom:14}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:5}}>
                <div style={{display:"flex",alignItems:"center",gap:7}}>
                  <div style={{width:8,height:8,borderRadius:2,background:typeColors[r.type]||"var(--t3)"}}/>
                  <span style={{fontSize:12,fontWeight:600,color:"var(--t1)"}}>{r.type}</span>
                  <span style={{fontSize:10,color:"var(--t3)"}}>{r.count} loan{r.count>1?"s":""}</span>
                </div>
                <div style={{textAlign:"right"}}>
                  <span style={{fontSize:13,fontWeight:700,color:"var(--t1)"}}>{f$(r.bal)}</span>
                  <span style={{fontSize:10,color:"var(--t3)",marginLeft:6}}>{r.pct.toFixed(1)}%</span>
                </div>
              </div>
              <div style={{height:6,background:"var(--bd)",borderRadius:3,overflow:"hidden"}}>
                <div style={{height:6,borderRadius:3,background:typeColors[r.type]||"var(--t3)",width:`${r.pct}%`}}/>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Maturity by year */}
      <div>
        <div className="sec-hdr"><div className="sec-t">Maturity Schedule</div><div className="sec-m">DEBT DUE BY YEAR</div></div>
        <div style={{background:"var(--white)",border:"1px solid var(--bd)",borderRadius:12,padding:"16px 18px"}}>
          {matYears.map(r=>{
            const isUrgent=parseInt(r.year)<=2026;
            return(
            <div key={r.year} style={{marginBottom:12}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:4}}>
                <span style={{fontSize:12,fontWeight:600,color:isUrgent?"var(--red)":"var(--t1)"}}>{r.year}</span>
                <div style={{textAlign:"right"}}>
                  <span style={{fontSize:13,fontWeight:700,color:isUrgent?"var(--red)":"var(--t1)"}}>{f$(r.bal)}</span>
                  <span style={{fontSize:10,color:"var(--t3)",marginLeft:6}}>{r.pct.toFixed(1)}%</span>
                </div>
              </div>
              <div style={{height:6,background:"var(--bd)",borderRadius:3,overflow:"hidden"}}>
                <div style={{height:6,borderRadius:3,background:isUrgent?"var(--red)":"var(--t1)",width:`${(r.bal/maxYrBal)*100}%`}}/>
              </div>
            </div>
          );})}
        </div>
      </div>
    </div>

    {/* Loan-level detail per lender */}
    <div className="sec-hdr"><div className="sec-t">All Loans by Lender</div><div className="sec-m">CLICK TO OPEN</div></div>
    {lenders.map(r=>(
      <div key={r.lender} style={{marginBottom:12}}>
        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
          <div style={{width:3,height:16,borderRadius:2,background:typeColors[r.type]||"var(--t3)"}}/>
          <span style={{fontSize:13,fontWeight:700,color:"var(--t1)"}}>{r.lender}</span>
          <span className="chip chip-grey">{r.type}</span>
          <span style={{fontSize:11,color:"var(--t3)",marginLeft:4}}>{f$(r.bal)} · {r.pct.toFixed(1)}% of portfolio</span>
        </div>
        <div className="tbl-wrap" style={{marginBottom:4}}>
          <table className="tbl">
            <thead><tr><th>Address</th><th>Balance</th><th>Rate</th><th>Maturity</th><th>Recourse</th><th>DSCR</th><th>Refi</th></tr></thead>
            <tbody>{r.loans.map(l=>(
              <tr key={l.id} onClick={()=>onSelect(loans.find(x=>x.id===l.id))}>
                <td><div className="td-a">{l.addr}</div><div className="td-b">{l.entity||"—"}</div></td>
                <td><span className="td-n">{f$(l.curBal)}</span></td>
                <td><span className={`td-n${l.rate>7?" red":l.rate>5?" amber":" green"}`}>{fPct(l.rate)}</span></td>
                <td><MatChip loan={l}/></td>
                <td><span className={`td-n${l.recourse?" amber":" green"}`}>{l.recourse?"Recourse":"NR"}</span></td>
                <td><span className={`td-n${l.dscr&&l.dscrCovenant&&l.dscr<l.dscrCovenant?" red":!l.dscr?" muted":l.dscr>1.3?" green":" amber"}`}>{l.dscr?l.dscr.toFixed(2)+"x":"—"}</span></td>
                <td><RefiChip status={l.refiStatus}/></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </div>
    ))}
  </div>);
}

/* ─────────── NOI & DSCR TRACKER ─────────── */
function NOIDSCRTracker({loans,onSelect}){
  const [noILog,setNoiLog]=useState({});
  const [loaded,setLoaded]=useState(false);
  const [selId,setSelId]=useState(String(loans[0]?.id||""));
  const [form,setForm]=useState({date:"",noi:"",notes:""});
  const [adding,setAdding]=useState(false);

  useEffect(()=>{(async()=>{try{const r=await supaStorage.get("meridian-noi");if(r?.value)setNoiLog(JSON.parse(r.value));}catch{}setLoaded(true);})();},[]);
  useEffect(()=>{if(!loaded)return;(async()=>{try{await supaStorage.set("meridian-noi",JSON.stringify(noILog));}catch{}})();},[noILog,loaded]);

  const sel=loans.find(l=>String(l.id)===selId);
  const en=sel?enrich(sel):null;
  const entries=(noILog[selId]||[]).slice().sort((a,b)=>b.date.localeCompare(a.date));

  const addEntry=()=>{
    if(!form.date||!form.noi)return;
    const entry={id:Date.now(),date:form.date,noi:parseFloat(form.noi),notes:form.notes};
    setNoiLog(p=>({...p,[selId]:[...(p[selId]||[]),entry]}));
    setForm({date:"",noi:"",notes:""});setAdding(false);
  };
  const delEntry=id=>setNoiLog(p=>({...p,[selId]:(p[selId]||[]).filter(e=>e.id!==id)}));

  // Build chart data from entries
  const chartEntries=[...entries].reverse().slice(-8);
  const maxNoi=Math.max(...chartEntries.map(e=>e.noi),1);

  // Per-entry DSCR
  const annualDS=en?en.pmt*12:0;
  const dscrForNoi=noi=>annualDS>0?(noi/annualDS).toFixed(2)+"x":"—";
  const covenant=sel?.dscrCovenant;

  // Portfolio summary — all loans with covenants
  const allWithCov=loans.filter(l=>l.dscrCovenant).map(l=>{
    const el=enrich(l);
    const latestEntry=(noILog[String(l.id)]||[]).sort((a,b)=>b.date.localeCompare(a.date))[0];
    const latestNoi=latestEntry?.noi||l.annualNOI;
    const dscr=latestNoi&&el.pmt>0?latestNoi/(el.pmt*12):null;
    const gap=dscr&&l.dscrCovenant?((dscr-l.dscrCovenant)/l.dscrCovenant*100):null;
    return{...l,el,latestNoi,dscr,gap,latestDate:latestEntry?.date};
  });

  if(loans.length===0)return(<div style={{padding:"64px 40px",textAlign:"center"}}>
    <div style={{fontSize:32,opacity:.2,marginBottom:12}}>📊</div>
    <div style={{fontSize:16,fontWeight:700,color:"var(--t3)"}}>No loans yet — add loans to track NOI and DSCR.</div>
  </div>);

  return(<div>
    <div style={{marginBottom:20}}>
      <div style={{fontSize:22,fontWeight:700,color:"var(--t1)",marginBottom:4}}>NOI & DSCR Tracker</div>
      <div style={{fontSize:13,color:"var(--t3)"}}>Log quarterly NOI for each property, track DSCR trends, and monitor covenant headroom over time.</div>
    </div>

    {/* Portfolio DSCR summary table */}
    {allWithCov.length>0&&<>
      <div style={{fontSize:13,fontWeight:700,color:"var(--t1)",marginBottom:10}}>Portfolio Covenant Overview</div>
      <div style={{background:"var(--white)",border:"1px solid var(--bd)",borderRadius:14,marginBottom:24,overflow:"hidden"}}>
        <table className="tbl">
          <thead><tr><th>Property</th><th>Latest NOI</th><th>Annual DS</th><th>DSCR</th><th>Covenant</th><th>Headroom</th><th>Last Updated</th></tr></thead>
          <tbody>{allWithCov.sort((a,b)=>(a.gap??99)-(b.gap??99)).map(l=>{
            const status=!l.dscr?"unknown":l.dscr<l.dscrCovenant?"breach":l.gap<10?"warning":"ok";
            const stC={breach:"var(--red)",warning:"var(--amber)",ok:"var(--green)",unknown:"var(--t4)"}[status];
            return(<tr key={l.id} onClick={()=>{setSelId(String(l.id));}} style={{cursor:"pointer",background:status==="breach"?"var(--rbg)":status==="warning"?"var(--abg)":""}}>
              <td><div className="td-a">{l.addr}</div><div className="td-b">{l.lender}</div></td>
              <td><span className="td-n">{l.latestNoi?f$(l.latestNoi):"—"}</span></td>
              <td><span className="td-n">{f$(l.el.annualDS)}</span></td>
              <td><span className="td-n" style={{color:stC,fontSize:15}}>{l.dscr?l.dscr.toFixed(2)+"x":"—"}</span></td>
              <td><span className="td-n">{l.dscrCovenant}x</span></td>
              <td>
                {l.gap!=null?<>
                  <div style={{width:80,height:6,background:"var(--bd)",borderRadius:3,overflow:"hidden",marginBottom:2}}>
                    <div style={{width:`${Math.min(100,Math.max(0,l.gap+10))}%`,height:6,background:stC,borderRadius:3}}/>
                  </div>
                  <div style={{fontSize:10,color:stC,fontWeight:600}}>{l.gap>=0?"+":""}{l.gap.toFixed(1)}%</div>
                </>:<span style={{color:"var(--t4)",fontSize:11}}>No data</span>}
              </td>
              <td><span style={{fontSize:11,color:"var(--t3)"}}>{l.latestDate||"Never"}</span></td>
            </tr>);
          })}</tbody>
        </table>
      </div>
    </>}

    {/* Per-loan NOI log */}
    <div style={{display:"grid",gridTemplateColumns:"220px 1fr",gap:16,alignItems:"start"}}>
      {/* Loan selector */}
      <div style={{background:"var(--white)",border:"1px solid var(--bd)",borderRadius:12,overflow:"hidden",position:"sticky",top:0}}>
        <div style={{padding:"10px 14px",borderBottom:"1px solid var(--bd)",fontSize:10,fontWeight:700,color:"var(--t3)",textTransform:"uppercase",letterSpacing:".07em"}}>Property</div>
        <div style={{maxHeight:460,overflowY:"auto"}}>
          {loans.map(l=>{
            const cnt=(noILog[String(l.id)]||[]).length;
            const isActive=String(l.id)===selId;
            return(<div key={l.id} onClick={()=>setSelId(String(l.id))}
              style={{padding:"10px 14px",cursor:"pointer",background:isActive?"var(--bg)":"transparent",borderLeft:`2px solid ${isActive?"var(--t1)":"transparent"}`,borderBottom:"1px solid var(--bd)"}}>
              <div style={{fontSize:11,fontWeight:700,color:isActive?"var(--t1)":"var(--t2)",marginBottom:2}}>{l.addr}</div>
              <div style={{fontSize:10,color:"var(--t3)"}}>{cnt>0?`${cnt} entries`:"No entries yet"}</div>
            </div>);
          })}
        </div>
      </div>

      {/* Log + chart */}
      <div>
        {sel&&<>
          {/* Property header */}
          <div style={{background:"var(--white)",border:"1px solid var(--bd)",borderRadius:12,padding:"14px 18px",marginBottom:12,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div>
              <div style={{fontSize:15,fontWeight:700,color:"var(--t1)"}}>{sel.addr}</div>
              <div style={{fontSize:11,color:"var(--t3)"}}>Monthly DS: {f$(en?.pmt)} · Annual DS: {f$(en?.annualDS)} {covenant?`· Covenant: ${covenant}x`:""}</div>
            </div>
            <button className="btn-dark" onClick={()=>setAdding(true)}>+ Log NOI</button>
          </div>

          {/* Add form */}
          {adding&&<div style={{background:"var(--white)",border:"1px solid var(--bd)",borderRadius:12,padding:"16px 18px",marginBottom:12,boxShadow:"0 4px 12px rgba(0,0,0,.07)"}}>
            <div style={{fontSize:13,fontWeight:700,color:"var(--t1)",marginBottom:12}}>Log NOI Entry</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
              <div><div className="flbl" style={{display:"block",marginBottom:3}}>Period (YYYY-MM)</div><input className="finp" type="month" value={form.date} onChange={e=>setForm(p=>({...p,date:e.target.value}))}/></div>
              <div><div className="flbl" style={{display:"block",marginBottom:3}}>Annual NOI ($) *</div><input className="finp" type="number" placeholder="480000" value={form.noi} onChange={e=>setForm(p=>({...p,noi:e.target.value}))}/></div>
              <div style={{gridColumn:"span 2"}}><div className="flbl" style={{display:"block",marginBottom:3}}>Notes</div><input className="finp" placeholder="Vacancy increased, new lease signed, etc." value={form.notes} onChange={e=>setForm(p=>({...p,notes:e.target.value}))}/></div>
            </div>
            <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
              <button className="btn-light" onClick={()=>{setAdding(false);setForm({date:"",noi:"",notes:""});}}>Cancel</button>
              <button className="btn-dark" onClick={addEntry}>Save Entry</button>
            </div>
          </div>}

          {/* Mini bar chart */}
          {chartEntries.length>1&&<div style={{background:"var(--white)",border:"1px solid var(--bd)",borderRadius:12,padding:"16px 18px",marginBottom:12}}>
            <div style={{fontSize:11,fontWeight:700,color:"var(--t2)",marginBottom:12}}>NOI Trend — Last {chartEntries.length} periods</div>
            <div style={{display:"flex",gap:6,alignItems:"flex-end",height:80}}>
              {chartEntries.map((e,i)=>{
                const h=Math.max(8,Math.round((e.noi/maxNoi)*72));
                const dscr=annualDS>0?e.noi/annualDS:null;
                const c=!dscr?"var(--t4)":dscr<(covenant||1.2)?"var(--red)":dscr<(covenant||1.2)*1.1?"var(--amber)":"var(--green)";
                return(<div key={e.id} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:3}}>
                  <div style={{fontSize:9,color:"var(--t4)",textAlign:"center"}}>{f$(e.noi)}</div>
                  <div style={{width:"100%",height:h,background:c,borderRadius:4,opacity:.8}}/>
                  <div style={{fontSize:8,color:"var(--t4)",textAlign:"center",lineHeight:1.2}}>{e.date.slice(0,7)}</div>
                </div>);
              })}
            </div>
            {annualDS>0&&<div style={{height:2,background:"var(--bd2)",marginTop:6,position:"relative"}}>
              <div style={{position:"absolute",right:0,top:-10,fontSize:8,color:"var(--t3)"}}>DS line: {f$(annualDS)}/yr</div>
            </div>}
          </div>}

          {/* Entry list */}
          {entries.length===0?<div style={{background:"var(--white)",border:"2px dashed var(--bd2)",borderRadius:12,padding:"40px 24px",textAlign:"center"}}>
            <div style={{fontSize:28,opacity:.15,marginBottom:8}}>📊</div>
            <div style={{fontSize:13,fontWeight:600,color:"var(--t3)"}}>No NOI entries yet for this property</div>
            <div style={{fontSize:11,color:"var(--t4)",marginTop:4}}>Log quarterly NOI to track DSCR over time.</div>
          </div>:<div style={{display:"flex",flexDirection:"column",gap:8}}>
            {entries.map(e=>{
              const dscr=annualDS>0?(e.noi/annualDS):null;
              const ok=!covenant||!dscr||dscr>=covenant;
              const warn=covenant&&dscr&&dscr>=covenant&&dscr<covenant*1.1;
              return(<div key={e.id} style={{background:"var(--white)",border:`1px solid ${!ok?"var(--rbd)":warn?"var(--abd)":"var(--bd)"}`,borderRadius:10,padding:"13px 16px",display:"flex",alignItems:"center",gap:16}}>
                <div style={{width:4,height:40,borderRadius:2,background:!ok?"var(--red)":warn?"var(--amber)":"var(--green)",flexShrink:0}}/>
                <div style={{flex:1}}>
                  <div style={{fontSize:12,fontWeight:700,color:"var(--t1)"}}>{e.date}</div>
                  {e.notes&&<div style={{fontSize:11,color:"var(--t3)",marginTop:2}}>{e.notes}</div>}
                </div>
                <div style={{textAlign:"right"}}>
                  <div style={{fontSize:16,fontWeight:700,color:"var(--t1)"}}>{f$(e.noi)}<span style={{fontSize:10,color:"var(--t3)",fontWeight:400}}>/yr</span></div>
                  {dscr&&<div style={{fontSize:12,fontWeight:700,color:!ok?"var(--red)":warn?"var(--amber)":"var(--green)"}}>{dscr.toFixed(2)}x DSCR</div>}
                </div>
                <button onClick={()=>delEntry(e.id)} style={{background:"none",border:"none",cursor:"pointer",fontSize:12,color:"var(--t4)",padding:"2px 6px"}}>✕</button>
              </div>);
            })}
          </div>}
        </>}
      </div>
    </div>
  </div>);
}

/* ─────────── COVENANT MONITOR ─────────── */
function CovenantMonitor({loans,onSelect}){
  const [noILog,setNoiLog]=useState({});
  const [loaded,setLoaded]=useState(false);
  useEffect(()=>{(async()=>{try{const r=await supaStorage.get("meridian-noi");if(r?.value)setNoiLog(JSON.parse(r.value));}catch{}setLoaded(true);})();},[]);

  const withCov=useMemo(()=>loans.filter(l=>l.dscrCovenant).map(l=>{
    const el=enrich(l);
    const hist=(noILog[String(l.id)]||[]).sort((a,b)=>b.date.localeCompare(a.date));
    const latestNoi=hist[0]?.noi||l.annualNOI;
    const dscr=latestNoi&&el.pmt>0?latestNoi/(el.pmt*12):null;
    const headroom=dscr&&l.dscrCovenant?((dscr-l.dscrCovenant)/l.dscrCovenant*100):null;
    const status=!dscr?"unknown":dscr<l.dscrCovenant?"breach":headroom<10?"warning":headroom<25?"caution":"ok";
    const trend=hist.length>=2?(()=>{const a=hist[0].noi/(el.pmt*12),b=hist[1].noi/(el.pmt*12);return a>b?"up":a<b?"down":"flat";})():"unknown";
    return{...l,el,latestNoi,dscr,headroom,status,trend,hist};
  }),[loans,noILog]);

  const breaches=withCov.filter(l=>l.status==="breach");
  const warnings=withCov.filter(l=>l.status==="warning");
  const cautions=withCov.filter(l=>l.status==="caution");
  const healthy=withCov.filter(l=>l.status==="ok");
  const noData=withCov.filter(l=>l.status==="unknown");

  const statusStyle={
    breach:{bg:"var(--rbg)",bd:"var(--rbd)",c:"var(--red)",label:"BREACH",icon:"🔴"},
    warning:{bg:"#fff8e1",bd:"var(--abd)",c:"var(--amber)",label:"WARNING",icon:"⚠️"},
    caution:{bg:"#fffbeb",bd:"#fde68a",c:"#b45309",label:"CAUTION",icon:"🟡"},
    ok:{bg:"var(--gbg)",bd:"var(--gbd)",c:"var(--green)",label:"HEALTHY",icon:"✅"},
    unknown:{bg:"var(--bg)",bd:"var(--bd)",c:"var(--t4)",label:"NO DATA",icon:"❓"},
  };

  const LoanCard=({l})=>{
    const ss=statusStyle[l.status];
    return(<div onClick={()=>onSelect(loans.find(x=>x.id===l.id))}
      style={{background:ss.bg,border:`1px solid ${ss.bd}`,borderRadius:12,padding:"16px 18px",cursor:"pointer",transition:"transform .1s,box-shadow .1s"}}
      onMouseEnter={e=>{e.currentTarget.style.transform="translateY(-1px)";e.currentTarget.style.boxShadow="0 4px 12px rgba(0,0,0,.08)";}}
      onMouseLeave={e=>{e.currentTarget.style.transform="";e.currentTarget.style.boxShadow="";}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10}}>
        <div>
          <div style={{fontSize:12,fontWeight:700,color:"var(--t1)",marginBottom:2}}>{l.addr}</div>
          <div style={{fontSize:10,color:"var(--t3)"}}>{l.lender} · {fPct(l.rate)} {l.loanType}</div>
        </div>
        <span style={{fontSize:9,fontWeight:800,padding:"3px 10px",borderRadius:20,background:ss.c,color:"#fff",letterSpacing:".06em"}}>{ss.icon} {ss.label}</span>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:10}}>
        {[
          {l:"DSCR",v:l.dscr?l.dscr.toFixed(2)+"x":"—",c:ss.c},
          {l:"Covenant",v:l.dscrCovenant+"x",c:"var(--t2)"},
          {l:"Headroom",v:l.headroom!=null?(l.headroom>=0?"+":"")+l.headroom.toFixed(1)+"%":"—",c:l.headroom!=null&&l.headroom<0?"var(--red)":l.headroom<10?"var(--amber)":"var(--green)"},
        ].map((k,i)=><div key={i} style={{background:"rgba(255,255,255,.6)",borderRadius:8,padding:"8px 10px"}}>
          <div style={{fontSize:8,fontWeight:700,color:"var(--t3)",textTransform:"uppercase",letterSpacing:".06em",marginBottom:3}}>{k.l}</div>
          <div style={{fontSize:14,fontWeight:700,color:k.c}}>{k.v}</div>
        </div>)}
      </div>
      {/* Mini trend */}
      {l.hist.length>1&&<div style={{display:"flex",gap:3,alignItems:"flex-end",height:28,marginBottom:6}}>
        {l.hist.slice(0,6).reverse().map((e,i)=>{
          const d=e.noi/(l.el.pmt*12);
          const h=Math.max(4,Math.round((d/Math.max(...l.hist.map(x=>x.noi/(l.el.pmt*12))))*24));
          return(<div key={i} style={{flex:1,height:h,borderRadius:2,background:d<l.dscrCovenant?"var(--red)":d<l.dscrCovenant*1.1?"var(--amber)":"var(--green)",opacity:.7}}/>);
        })}
        <div style={{fontSize:9,color:"var(--t3)",marginLeft:4,whiteSpace:"nowrap"}}>DSCR trend {l.trend==="up"?"↑":l.trend==="down"?"↓":"→"}</div>
      </div>}
      <div style={{display:"flex",justifyContent:"space-between",fontSize:10,color:"var(--t3)"}}>
        <span>NOI: {l.latestNoi?f$(l.latestNoi):"Not logged"}</span>
        <span>DS: {f$(l.el.annualDS)}/yr</span>
        <span>Matures: {fDateS(l.maturityDate)}</span>
      </div>
    </div>);
  };

  if(withCov.length===0)return(<div style={{padding:"64px 40px",textAlign:"center"}}>
    <div style={{fontSize:32,opacity:.2,marginBottom:12}}>🛡️</div>
    <div style={{fontSize:16,fontWeight:700,color:"var(--t3)",marginBottom:6}}>No loans with DSCR covenants found</div>
    <div style={{fontSize:12,color:"var(--t4)"}}>Add a DSCR Covenant value when editing a loan to enable monitoring.</div>
  </div>);

  return(<div>
    <div style={{marginBottom:20}}>
      <div style={{fontSize:22,fontWeight:700,color:"var(--t1)",marginBottom:4}}>Covenant Monitor</div>
      <div style={{fontSize:13,color:"var(--t3)"}}>{withCov.length} loans with DSCR covenants · Click any card to open loan detail</div>
    </div>

    {/* Summary KPIs */}
    <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:24}}>
      {[
        {l:"Covenant Breaches",v:breaches.length,c:"var(--red)",bg:"var(--rbg)",bd:"var(--rbd)"},
        {l:"Within 10% of Breach",v:warnings.length,c:"var(--amber)",bg:"#fffbeb",bd:"var(--abd)"},
        {l:"Caution (10–25%)",v:cautions.length,c:"#b45309",bg:"#fffbeb",bd:"#fde68a"},
        {l:"Healthy",v:healthy.length,c:"var(--green)",bg:"var(--gbg)",bd:"var(--gbd)"},
      ].map((k,i)=><div key={i} style={{background:k.bg,border:`1px solid ${k.bd}`,borderRadius:12,padding:"14px 16px"}}>
        <div style={{fontSize:9,fontWeight:700,color:k.c,textTransform:"uppercase",letterSpacing:".07em",marginBottom:6}}>{k.l}</div>
        <div style={{fontSize:28,fontWeight:800,color:k.c,lineHeight:1}}>{k.v}</div>
      </div>)}
    </div>

    {/* Cards by status group */}
    {[
      {label:"🔴 Covenant Breaches — Immediate Action Required",items:breaches},
      {label:"⚠️ Within 10% of Covenant — Monitor Closely",items:warnings},
      {label:"🟡 Caution Zone (10–25% headroom)",items:cautions},
      {label:"✅ Healthy Coverage",items:healthy},
      {label:"❓ No NOI Data Logged",items:noData},
    ].filter(g=>g.items.length>0).map(g=>(
      <div key={g.label} style={{marginBottom:24}}>
        <div style={{fontSize:12,fontWeight:700,color:"var(--t2)",marginBottom:10}}>{g.label}</div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:10}}>
          {g.items.map(l=><LoanCard key={l.id} l={l}/>)}
        </div>
      </div>
    ))}
  </div>);
}

/* ─────────── RATE CAP TRACKER ─────────── */
function RateCapTracker({loans,onSelect}){
  const [sofr,setSofr]=useState("5.33");

  const armLoans=useMemo(()=>loans.filter(l=>l.loanType==="ARM"||l.loanType==="SOFR").map(l=>{
    const el=enrich(l);
    const hasCap=!!(l.capRate&&l.capExpiry);
    const daysToCapExpiry=l.capExpiry?daysTo(l.capExpiry):null;
    const daysToMaturity=el.daysLeft;
    const capExpiresBeforeMaturity=hasCap&&daysToCapExpiry<daysToMaturity;
    const currentSOFR=parseFloat(sofr)||0;
    const spread=Math.max(0,l.rate-currentSOFR); // estimated loan spread
    const rateAtCap=hasCap?l.capRate:null;
    const pmtAtCap=hasCap?calcPmt(el.curBal,rateAtCap,Math.max(1,(l.amortYears||l.termYears||1)*12-mosBetween(l.origDate||TODAY_STR,TODAY_STR))):null;
    const pmtAtSofr500=calcPmt(el.curBal,currentSOFR+spread+2,Math.max(1,(l.amortYears||l.termYears||1)*12-mosBetween(l.origDate||TODAY_STR,TODAY_STR)));
    const urgency=!hasCap?"no-cap":daysToCapExpiry<0?"expired":daysToCapExpiry<90?"critical":daysToCapExpiry<180?"urgent":daysToCapExpiry<365?"soon":"ok";
    return{...l,el,hasCap,daysToCapExpiry,capExpiresBeforeMaturity,rateAtCap,pmtAtCap,pmtAtSofr500,urgency,spread};
  }),[loans,sofr]);

  const noCapLoans=armLoans.filter(l=>!l.hasCap);
  const expiredCaps=armLoans.filter(l=>l.hasCap&&l.urgency==="expired");
  const criticalCaps=armLoans.filter(l=>l.urgency==="critical");
  const urgentCaps=armLoans.filter(l=>l.urgency==="urgent");
  const soonCaps=armLoans.filter(l=>l.urgency==="soon");
  const okCaps=armLoans.filter(l=>l.urgency==="ok");

  const urgStyle={
    "no-cap":{c:"var(--red)",bg:"var(--rbg)",bd:"var(--rbd)",label:"NO CAP"},
    "expired":{c:"var(--red)",bg:"var(--rbg)",bd:"var(--rbd)",label:"EXPIRED"},
    "critical":{c:"var(--red)",bg:"var(--rbg)",bd:"var(--rbd)",label:"< 90 DAYS"},
    "urgent":{c:"var(--amber)",bg:"#fffbeb",bd:"var(--abd)",label:"< 6 MO"},
    "soon":{c:"#b45309",bg:"#fffbeb",bd:"#fde68a",label:"< 12 MO"},
    "ok":{c:"var(--green)",bg:"var(--gbg)",bd:"var(--gbd)",label:"OK"},
  };

  if(armLoans.length===0)return(<div style={{padding:"64px 40px",textAlign:"center"}}>
    <div style={{fontSize:32,opacity:.2,marginBottom:12}}>📉</div>
    <div style={{fontSize:16,fontWeight:700,color:"var(--t3)"}}>No ARM or SOFR loans in your portfolio.</div>
  </div>);

  const totalArmBal=armLoans.reduce((s,l)=>s+l.el.curBal,0);
  const unprotectedBal=[...noCapLoans,...expiredCaps].reduce((s,l)=>s+l.el.curBal,0);

  return(<div>
    <div style={{marginBottom:20}}>
      <div style={{fontSize:22,fontWeight:700,color:"var(--t1)",marginBottom:4}}>Rate Cap Tracker</div>
      <div style={{fontSize:13,color:"var(--t3)"}}>Monitor all ARM & SOFR rate caps, expiry dates, and unprotected rate exposure.</div>
    </div>

    {/* SOFR input + summary */}
    <div style={{display:"grid",gridTemplateColumns:"auto 1fr",gap:12,marginBottom:20,alignItems:"stretch"}}>
      <div style={{background:"var(--white)",border:"2px solid var(--blue)",borderRadius:14,padding:"16px 20px",display:"flex",alignItems:"center",gap:16}}>
        <div>
          <div style={{fontSize:10,fontWeight:700,color:"var(--blue)",textTransform:"uppercase",letterSpacing:".08em",marginBottom:4}}>Current SOFR (%)</div>
          <div style={{fontSize:11,color:"var(--t3)",marginBottom:8}}>Update to live rate for accurate modeling</div>
        </div>
        <input type="number" step="0.01" value={sofr} onChange={e=>setSofr(e.target.value)}
          style={{width:90,padding:"10px 12px",border:"2px solid var(--blue)",borderRadius:9,fontSize:20,fontWeight:800,color:"var(--blue)",textAlign:"center",outline:"none"}}/>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10}}>
        {[
          {l:"ARM / SOFR Loans",v:armLoans.length,c:"var(--blue)",bg:"var(--bbg)",bd:"var(--bbd)"},
          {l:"Total ARM Exposure",v:f$(totalArmBal),c:"var(--t1)",bg:"var(--white)",bd:"var(--bd)"},
          {l:"Unprotected Balance",v:f$(unprotectedBal),c:unprotectedBal>0?"var(--red)":"var(--green)",bg:unprotectedBal>0?"var(--rbg)":"var(--gbg)",bd:unprotectedBal>0?"var(--rbd)":"var(--gbd)"},
          {l:"Caps Expiring < 1yr",v:criticalCaps.length+urgentCaps.length+soonCaps.length,c:"var(--amber)",bg:"#fffbeb",bd:"var(--abd)"},
        ].map((k,i)=><div key={i} style={{background:k.bg,border:`1px solid ${k.bd}`,borderRadius:12,padding:"14px 16px"}}>
          <div style={{fontSize:9,fontWeight:700,color:k.c,textTransform:"uppercase",letterSpacing:".07em",marginBottom:6}}>{k.l}</div>
          <div style={{fontSize:22,fontWeight:800,color:k.c,lineHeight:1}}>{k.v}</div>
        </div>)}
      </div>
    </div>

    {/* Loan cards */}
    {[
      {label:"🔴 No Cap / Expired — Fully Exposed",items:[...noCapLoans,...expiredCaps]},
      {label:"🚨 Critical — Cap Expires < 90 Days",items:criticalCaps},
      {label:"⚠️ Urgent — Cap Expires < 6 Months",items:urgentCaps},
      {label:"🕐 Soon — Cap Expires < 12 Months",items:soonCaps},
      {label:"✅ Protected — Cap OK",items:okCaps},
    ].filter(g=>g.items.length>0).map(g=>(
      <div key={g.label} style={{marginBottom:20}}>
        <div style={{fontSize:12,fontWeight:700,color:"var(--t2)",marginBottom:10}}>{g.label}</div>
        <div style={{display:"flex",flexDirection:"column",gap:8}}>
          {g.items.map(l=>{
            const ss=urgStyle[l.urgency];
            return(<div key={l.id} onClick={()=>onSelect(loans.find(x=>x.id===l.id))}
              style={{background:ss.bg,border:`1px solid ${ss.bd}`,borderRadius:12,padding:"15px 18px",cursor:"pointer",display:"flex",alignItems:"center",gap:16}}>
              <div style={{flex:2,minWidth:0}}>
                <div style={{fontSize:13,fontWeight:700,color:"var(--t1)",marginBottom:2}}>{l.addr}</div>
                <div style={{fontSize:10,color:"var(--t3)"}}>{l.lender} · {l.loanType} @ {fPct(l.rate)}</div>
              </div>
              <div style={{flex:1,textAlign:"center"}}>
                <div style={{fontSize:9,fontWeight:700,color:"var(--t3)",textTransform:"uppercase",letterSpacing:".06em",marginBottom:2}}>Cap Strike</div>
                <div style={{fontSize:15,fontWeight:700,color:ss.c}}>{l.capRate?fPct(l.capRate):"None"}</div>
              </div>
              <div style={{flex:1,textAlign:"center"}}>
                <div style={{fontSize:9,fontWeight:700,color:"var(--t3)",textTransform:"uppercase",letterSpacing:".06em",marginBottom:2}}>Cap Provider</div>
                <div style={{fontSize:12,fontWeight:600,color:"var(--t2)"}}>{l.capProvider||"—"}</div>
              </div>
              <div style={{flex:1,textAlign:"center"}}>
                <div style={{fontSize:9,fontWeight:700,color:"var(--t3)",textTransform:"uppercase",letterSpacing:".06em",marginBottom:2}}>Cap Expiry</div>
                <div style={{fontSize:12,fontWeight:700,color:ss.c}}>{l.capExpiry?fDateS(l.capExpiry):"—"}</div>
                {l.daysToCapExpiry!=null&&<div style={{fontSize:10,color:ss.c,fontWeight:600}}>{l.daysToCapExpiry<0?`${Math.abs(l.daysToCapExpiry)}d expired`:`${l.daysToCapExpiry}d left`}</div>}
              </div>
              <div style={{flex:1,textAlign:"center"}}>
                <div style={{fontSize:9,fontWeight:700,color:"var(--t3)",textTransform:"uppercase",letterSpacing:".06em",marginBottom:2}}>Loan Matures</div>
                <div style={{fontSize:12,fontWeight:600,color:"var(--t2)"}}>{fDateS(l.maturityDate)}</div>
              </div>
              <div style={{flex:1,textAlign:"center"}}>
                <div style={{fontSize:9,fontWeight:700,color:"var(--t3)",textTransform:"uppercase",letterSpacing:".06em",marginBottom:2}}>Balance</div>
                <div style={{fontSize:13,fontWeight:700,color:"var(--t1)"}}>{f$(l.el.curBal)}</div>
              </div>
              <span style={{fontSize:9,fontWeight:800,padding:"4px 12px",borderRadius:20,background:ss.c,color:"#fff",letterSpacing:".06em",flexShrink:0}}>{ss.label}</span>
            </div>);
          })}
        </div>
      </div>
    ))}
  </div>);
}

/* ─────────── LENDER CRM ─────────── */
function LenderCRM({loans,onSelect}){
  const [notes,setNotes]=useState({});
  const [loaded,setLoaded]=useState(false);
  const [selLender,setSelLender]=useState(null);
  const [newNote,setNewNote]=useState("");
  const [noteType,setNoteType]=useState("call");

  useEffect(()=>{(async()=>{try{const r=await supaStorage.get("meridian-lender-crm");if(r?.value)setNotes(JSON.parse(r.value));}catch{}setLoaded(true);})();},[]);
  useEffect(()=>{if(!loaded)return;(async()=>{try{await supaStorage.set("meridian-lender-crm",JSON.stringify(notes));}catch{}})();},[notes,loaded]);

  // Group loans by lender
  const lenderMap=useMemo(()=>{
    const m={};
    loans.forEach(l=>{
      const k=l.lender||"Unknown";
      if(!m[k])m[k]={loans:[],totalBal:0,servicerName:l.servicerName,servicerPhone:l.servicerPhone,servicerEmail:l.servicerEmail};
      m[k].loans.push(l);
      m[k].totalBal+=enrich(l).curBal;
    });
    return m;
  },[loans]);

  const lenders=Object.entries(lenderMap).sort((a,b)=>b[1].totalBal-a[1].totalBal);
  const totalPort=loans.map(enrich).reduce((s,l)=>s+l.curBal,0);

  const addNote=()=>{
    if(!newNote.trim()||!selLender)return;
    const entry={id:Date.now(),type:noteType,text:newNote.trim(),date:TODAY_STR};
    setNotes(p=>({...p,[selLender]:[...(p[selLender]||[]),entry]}));
    setNewNote("");
  };
  const delNote=(lender,id)=>setNotes(p=>({...p,[lender]:(p[lender]||[]).filter(n=>n.id!==id)}));

  const urgencyForLender=ldata=>{
    const en=ldata.loans.map(enrich);
    if(en.some(l=>l.status==="matured"||l.status==="urgent"))return"red";
    if(en.some(l=>l.status==="soon"))return"amber";
    return"green";
  };

  if(loans.length===0)return(<div style={{padding:"64px 40px",textAlign:"center"}}>
    <div style={{fontSize:32,opacity:.2,marginBottom:12}}>🏦</div>
    <div style={{fontSize:16,fontWeight:700,color:"var(--t3)"}}>No loans yet. Add loans to build your lender CRM.</div>
  </div>);

  const LD=lenderMap[selLender];

  return(<div>
    <div style={{marginBottom:20}}>
      <div style={{fontSize:22,fontWeight:700,color:"var(--t1)",marginBottom:4}}>Lender Relationships</div>
      <div style={{fontSize:13,color:"var(--t3)"}}>{lenders.length} lenders · Track relationships, log calls, and manage exposure by institution.</div>
    </div>

    <div style={{display:"grid",gridTemplateColumns:"260px 1fr",gap:16,alignItems:"start"}}>
      {/* Lender list */}
      <div style={{background:"var(--white)",border:"1px solid var(--bd)",borderRadius:14,overflow:"hidden",position:"sticky",top:0}}>
        <div style={{padding:"10px 14px",borderBottom:"1px solid var(--bd)",fontSize:10,fontWeight:700,color:"var(--t3)",textTransform:"uppercase",letterSpacing:".07em"}}>Lenders by Exposure</div>
        <div style={{maxHeight:560,overflowY:"auto"}}>
          {lenders.map(([name,data])=>{
            const urg=urgencyForLender(data);
            const pct=totalPort>0?data.totalBal/totalPort*100:0;
            const isActive=selLender===name;
            const noteCount=(notes[name]||[]).length;
            return(<div key={name} onClick={()=>setSelLender(isActive?null:name)}
              style={{padding:"12px 14px",cursor:"pointer",background:isActive?"var(--bg)":"transparent",borderLeft:`2px solid ${isActive?"var(--t1)":"transparent"}`,borderBottom:"1px solid var(--bd)",transition:"background .1s"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:5}}>
                <div style={{fontSize:12,fontWeight:700,color:isActive?"var(--t1)":"var(--t2)",lineHeight:1.3,flex:1}}>{name}</div>
                <div style={{width:8,height:8,borderRadius:"50%",background:urg==="red"?"var(--red)":urg==="amber"?"var(--amber)":"var(--green)",flexShrink:0,marginTop:2}}/>
              </div>
              <div style={{fontSize:11,fontWeight:600,color:"var(--t1)",marginBottom:4}}>{f$(data.totalBal)}</div>
              <div style={{height:4,borderRadius:2,background:"var(--bd)",marginBottom:4,overflow:"hidden"}}>
                <div style={{width:`${Math.min(100,pct)}%`,height:4,background:"var(--blue)",borderRadius:2}}/>
              </div>
              <div style={{display:"flex",justifyContent:"space-between",fontSize:9,color:"var(--t3)"}}>
                <span>{data.loans.length} loan{data.loans.length!==1?"s":""}</span>
                <span>{pct.toFixed(1)}% of portfolio</span>
                {noteCount>0&&<span style={{color:"var(--blue)"}}>📝 {noteCount}</span>}
              </div>
            </div>);
          })}
        </div>
      </div>

      {/* Lender detail */}
      <div>
        {!selLender&&<div style={{background:"var(--white)",border:"2px dashed var(--bd2)",borderRadius:14,padding:"64px 40px",textAlign:"center"}}>
          <div style={{fontSize:32,opacity:.15,marginBottom:12}}>🏦</div>
          <div style={{fontSize:15,fontWeight:700,color:"var(--t3)"}}>Select a lender to view their profile</div>
        </div>}

        {selLender&&LD&&<>
          {/* Lender header */}
          <div style={{background:"var(--white)",border:"1px solid var(--bd)",borderRadius:14,padding:"20px 22px",marginBottom:14}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
              <div>
                <div style={{fontSize:20,fontWeight:800,color:"var(--t1)",marginBottom:2}}>{selLender}</div>
                <div style={{fontSize:12,color:"var(--t3)"}}>{LD.loans.length} loan{LD.loans.length!==1?"s":" "} · {f$(LD.totalBal)} total exposure · {(LD.totalBal/totalPort*100).toFixed(1)}% of portfolio</div>
              </div>
              <div style={{textAlign:"right"}}>
                {LD.servicerPhone&&<div style={{fontSize:11,color:"var(--blue)",marginBottom:2}}>📞 <a href={`tel:${LD.servicerPhone}`} style={{color:"var(--blue)",textDecoration:"none"}}>{LD.servicerPhone}</a> <CopyBtn text={LD.servicerPhone}/></div>}
                {LD.servicerEmail&&<div style={{fontSize:11,color:"var(--blue)"}}>✉️ <a href={`mailto:${LD.servicerEmail}`} style={{color:"var(--blue)",textDecoration:"none"}}>{LD.servicerEmail}</a></div>}
              </div>
            </div>

            {/* Loans for this lender */}
            <div style={{marginTop:16,borderTop:"1px solid var(--bd)",paddingTop:14}}>
              <div style={{fontSize:10,fontWeight:700,color:"var(--t3)",textTransform:"uppercase",letterSpacing:".07em",marginBottom:8}}>Loans with this lender</div>
              <div style={{display:"flex",flexDirection:"column",gap:6}}>
                {LD.loans.map(l=>{
                  const el=enrich(l);
                  const ss={matured:"var(--red)",urgent:"var(--red)",soon:"var(--amber)",ok:"var(--green)"}[el.status];
                  return(<div key={l.id} onClick={()=>onSelect(l)}
                    style={{display:"flex",alignItems:"center",gap:12,padding:"10px 12px",background:"var(--bg)",borderRadius:9,cursor:"pointer",border:"1px solid var(--bd)"}}
                    onMouseEnter={e=>e.currentTarget.style.background="var(--bd)"}
                    onMouseLeave={e=>e.currentTarget.style.background="var(--bg)"}>
                    <div style={{width:6,height:6,borderRadius:"50%",background:ss,flexShrink:0}}/>
                    <div style={{flex:2}}><div style={{fontSize:12,fontWeight:700,color:"var(--t1)"}}>{l.addr}</div><div style={{fontSize:10,color:"var(--t3)"}}>{l.entity||""}</div></div>
                    <div style={{flex:1,textAlign:"center"}}><div style={{fontSize:11,fontWeight:700,color:"var(--t1)"}}>{f$(el.curBal)}</div><div style={{fontSize:9,color:"var(--t3)"}}>{fPct(l.rate)} {l.loanType}</div></div>
                    <div style={{flex:1,textAlign:"center"}}><div style={{fontSize:11,color:ss,fontWeight:600}}>{fDateS(l.maturityDate)}</div><div style={{fontSize:9,color:"var(--t3)"}}>{el.daysLeft>0?`${el.daysLeft}d left`:`${Math.abs(el.daysLeft)}d over`}</div></div>
                    <RefiChip status={l.refiStatus}/>
                    <div style={{fontSize:12,color:"var(--t4)"}}>›</div>
                  </div>);
                })}
              </div>
            </div>
          </div>

          {/* Relationship notes / activity */}
          <div style={{background:"var(--white)",border:"1px solid var(--bd)",borderRadius:14,overflow:"hidden"}}>
            <div style={{padding:"12px 18px",borderBottom:"1px solid var(--bd)",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div style={{fontSize:12,fontWeight:700,color:"var(--t1)"}}>Relationship Notes</div>
              <div style={{fontSize:10,color:"var(--t3)"}}>{(notes[selLender]||[]).length} entries</div>
            </div>

            {/* Note input */}
            <div style={{padding:"12px 18px",borderBottom:"1px solid var(--bd)",background:"var(--bg)"}}>
              <div style={{display:"flex",gap:6,marginBottom:8,flexWrap:"wrap"}}>
                {ACT_TYPES.map(a=><button key={a.id} onClick={()=>setNoteType(a.id)}
                  style={{padding:"4px 12px",borderRadius:20,border:`1px solid ${noteType===a.id?"var(--t1)":"var(--bd)"}`,background:noteType===a.id?"var(--t1)":"var(--white)",color:noteType===a.id?"var(--white)":"var(--t3)",fontSize:11,cursor:"pointer"}}>
                  {a.icon} {a.label}
                </button>)}
              </div>
              <div style={{display:"flex",gap:8}}>
                <input className="finp" style={{flex:1}} placeholder="Log a call, email, meeting, term sheet discussion…" value={newNote} onChange={e=>setNewNote(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addNote()}/>
                <button className="btn-dark" style={{fontSize:12,padding:"6px 16px"}} onClick={addNote}>Add</button>
              </div>
            </div>

            {/* Notes list */}
            {(notes[selLender]||[]).length===0
              ?<div style={{padding:"32px",textAlign:"center",color:"var(--t4)",fontSize:12}}>No notes yet — log your first interaction above.</div>
              :[...(notes[selLender]||[])].reverse().map(n=>{
                const at=ACT_TYPES.find(a=>a.id===n.type)||ACT_TYPES[4];
                return(<div key={n.id} style={{display:"flex",gap:12,padding:"12px 18px",borderBottom:"1px solid var(--bd)"}}>
                  <div style={{fontSize:18,flexShrink:0}}>{at.icon}</div>
                  <div style={{flex:1}}>
                    <div style={{fontSize:12,color:"var(--t1)",lineHeight:1.6}}>{n.text}</div>
                    <div style={{fontSize:10,color:"var(--t4)",marginTop:3}}>{at.label} · {fDateF(n.date)}</div>
                  </div>
                  <button onClick={()=>delNote(selLender,n.id)} style={{background:"none",border:"none",cursor:"pointer",fontSize:11,color:"var(--t4)",flexShrink:0}}>✕</button>
                </div>);
              })
            }
          </div>
        </>}
      </div>
    </div>
  </div>);
}

/* ─────────── ALERT SYSTEM ─────────── */

// Condition definitions — each has a label, description, and evaluator
const ALERT_CONDITIONS = [
  {
    id:"maturity_days",
    label:"Maturity Approaching",
    icon:"📅",
    category:"maturity",
    desc:"Fires when a loan matures within a specified number of days",
    param:{key:"days",label:"Days before maturity",type:"number",default:90},
    eval:(loan,p)=>{ const el=enrich(loan); return el.daysLeft>=0&&el.daysLeft<=p.days; },
    severity:(loan,p)=>{ const d=enrich(loan).daysLeft; return d<=30?"critical":d<=60?"high":"medium"; },
    detail:(loan,p)=>{ const el=enrich(loan); return `Matures ${fDateF(loan.maturityDate)} — ${el.daysLeft} days remaining`; },
  },
  {
    id:"maturity_overdue",
    label:"Maturity Past Due",
    icon:"🔴",
    category:"maturity",
    desc:"Fires when a loan has already passed its maturity date",
    param:null,
    eval:(loan)=>enrich(loan).daysLeft<0,
    severity:()=>"critical",
    detail:(loan)=>{ const el=enrich(loan); return `${Math.abs(el.daysLeft)} days past maturity — immediate action required`; },
  },
  {
    id:"dscr_below_covenant",
    label:"DSCR Below Covenant",
    icon:"🛡️",
    category:"risk",
    desc:"Fires when a loan's DSCR falls below its covenant threshold",
    param:null,
    eval:(loan)=>{ const el=enrich(loan); return el.dscr&&loan.dscrCovenant&&el.dscr<loan.dscrCovenant; },
    severity:()=>"critical",
    detail:(loan)=>{ const el=enrich(loan); return `DSCR ${el.dscr?.toFixed(2)}x is below covenant ${loan.dscrCovenant}x`; },
  },
  {
    id:"dscr_warning",
    label:"DSCR Approaching Covenant",
    icon:"⚠️",
    category:"risk",
    desc:"Fires when DSCR is within a specified % of the covenant floor",
    param:{key:"pct",label:"Headroom threshold (%)",type:"number",default:15},
    eval:(loan,p)=>{ const el=enrich(loan); if(!el.dscr||!loan.dscrCovenant)return false; const headroom=(el.dscr-loan.dscrCovenant)/loan.dscrCovenant*100; return headroom>=0&&headroom<=p.pct; },
    severity:()=>"high",
    detail:(loan,p)=>{ const el=enrich(loan); const h=((el.dscr-loan.dscrCovenant)/loan.dscrCovenant*100).toFixed(1); return `DSCR ${el.dscr?.toFixed(2)}x — only ${h}% above ${loan.dscrCovenant}x covenant`; },
  },
  {
    id:"rate_cap_expiry",
    label:"Rate Cap Expiring",
    icon:"📉",
    category:"risk",
    desc:"Fires when an ARM loan's rate cap expires within N days",
    param:{key:"days",label:"Days before cap expiry",type:"number",default:180},
    eval:(loan,p)=>{ if(!loan.capExpiry||(loan.loanType!=="ARM"&&loan.loanType!=="SOFR"))return false; const d=daysTo(loan.capExpiry); return d>=0&&d<=p.days; },
    severity:(loan,p)=>{ const d=daysTo(loan.capExpiry||"2099-01-01"); return d<=60?"critical":d<=120?"high":"medium"; },
    detail:(loan)=>{ const d=daysTo(loan.capExpiry||"2099-01-01"); return `Rate cap${loan.capProvider?` (${loan.capProvider})`:""}${loan.capRate?` @ ${fPct(loan.capRate)}`:""} expires ${fDateF(loan.capExpiry)} — ${d} days away`; },
  },
  {
    id:"rate_cap_expired",
    label:"Rate Cap Expired — Unprotected",
    icon:"🚨",
    category:"risk",
    desc:"Fires when an ARM loan has no cap or an expired cap",
    param:null,
    eval:(loan)=>{ if(loan.loanType!=="ARM"&&loan.loanType!=="SOFR")return false; return !loan.capExpiry||daysTo(loan.capExpiry)<0; },
    severity:()=>"critical",
    detail:(loan)=>{ return loan.capExpiry?`Cap expired ${fDateF(loan.capExpiry)} — loan is unprotected`:`No rate cap on record for ${loan.loanType} loan`; },
  },
  {
    id:"refi_not_started",
    label:"Refi Not Started Near Maturity",
    icon:"🔄",
    category:"maturity",
    desc:"Flags loans maturing within N days where refi has not been initiated",
    param:{key:"days",label:"Days before maturity",type:"number",default:180},
    eval:(loan,p)=>{ const el=enrich(loan); return el.daysLeft>=0&&el.daysLeft<=p.days&&(!loan.refiStatus||loan.refiStatus==="Not Started"); },
    severity:(loan,p)=>{ const d=enrich(loan).daysLeft; return d<=90?"critical":d<=120?"high":"medium"; },
    detail:(loan)=>{ const el=enrich(loan); return `Matures in ${el.daysLeft}d — refi status: "${loan.refiStatus||"Not Started"}"`.trim(); },
  },
  {
    id:"balance_threshold",
    label:"Large Loan Balance Alert",
    icon:"💰",
    category:"financial",
    desc:"Always-on flag for loans above a specified balance threshold",
    param:{key:"amount",label:"Balance threshold ($)",type:"number",default:5000000},
    eval:(loan,p)=>{ const el=enrich(loan); return el.curBal>=p.amount; },
    severity:()=>"low",
    detail:(loan)=>{ const el=enrich(loan); return `Current balance: ${f$(el.curBal)}`; },
  },
  {
    id:"no_activity",
    label:"No Recent Activity",
    icon:"💤",
    category:"operational",
    desc:"Flags loans with no logged activity in the past N days",
    param:{key:"days",label:"Days since last activity",type:"number",default:60},
    eval:(loan,p)=>{ if(!loan.activityLog?.length)return true; const last=new Date(loan.activityLog[loan.activityLog.length-1].date); return (TODAY-last)/86400000>p.days; },
    severity:()=>"low",
    detail:(loan,p)=>{ if(!loan.activityLog?.length)return"No activity ever logged"; const last=loan.activityLog[loan.activityLog.length-1]; return `Last activity ${fDateF(last.date)} — ${Math.round((TODAY-new Date(last.date))/86400000)}d ago`; },
  },
  {
    id:"prepay_window",
    label:"Prepayment Window Opening",
    icon:"🔓",
    category:"maturity",
    desc:"Fires when a step-down loan enters its final 0% prepay year",
    param:{key:"days",label:"Days advance notice",type:"number",default:60},
    eval:(loan,p)=>{ if(!loan.prepay)return false; const nums=(loan.prepay||"").match(/\d+/g); if(!nums)return false; const steps=nums.map(Number); const yearsElapsed=Math.floor(mosBetween(loan.origDate||TODAY_STR,TODAY_STR)/12); return steps[yearsElapsed]===0||(steps.length>0&&yearsElapsed>=steps.length); },
    severity:()=>"medium",
    detail:(loan)=>{ return `Prepay schedule: ${loan.prepay} — current window may be open`; },
  },
];

const SEVERITY_META = {
  critical:{label:"Critical",color:"#dc2626",bg:"#fef2f2",bd:"#fecaca",dot:"#dc2626"},
  high:    {label:"High",color:"#d97706",bg:"#fffbeb",bd:"#fde68a",dot:"#f59e0b"},
  medium:  {label:"Medium",color:"#2563eb",bg:"#eff6ff",bd:"#bfdbfe",dot:"#3b82f6"},
  low:     {label:"Low",color:"#6b7280",bg:"#f9fafb",bd:"#e5e7eb",dot:"#9ca3af"},
};

const CHANNELS = [
  {id:"email",icon:"✉️",label:"Email"},
  {id:"sms",icon:"📱",label:"SMS / Text"},
  {id:"both",icon:"📣",label:"Email + SMS"},
];

function AlertSystem({loans}){
  // Rules storage
  const [rules,setRules] = useState([]);
  const [recipients,setRecipients] = useState([]);
  const [alertLog,setAlertLog] = useState([]);
  const [loaded,setLoaded] = useState(false);

  // UI state
  const [activeTab,setActiveTab] = useState("dashboard"); // dashboard | rules | recipients | log | preview
  const [editRule,setEditRule] = useState(null); // null | "new" | ruleId
  const [previewAlert,setPreviewAlert] = useState(null);
  const [generatingMsg,setGeneratingMsg] = useState(false);
  const [generatedMsg,setGeneratedMsg] = useState(null);
  const [filterSeverity,setFilterSeverity] = useState("all");
  const [searchFilter,setSearchFilter] = useState("");

  // Load/save
  useEffect(()=>{(async()=>{
    try{
      const r=await supaStorage.get("meridian-alert-rules"); if(r?.value)setRules(JSON.parse(r.value));
      const rc=await supaStorage.get("meridian-alert-recipients"); if(rc?.value)setRecipients(JSON.parse(rc.value));
      const al=await supaStorage.get("meridian-alert-log"); if(al?.value)setAlertLog(JSON.parse(al.value));
    }catch{}
    setLoaded(true);
  })();},[]);
  useEffect(()=>{if(!loaded)return;(async()=>{try{await supaStorage.set("meridian-alert-rules",JSON.stringify(rules));}catch{}})();},[rules,loaded]);
  useEffect(()=>{if(!loaded)return;(async()=>{try{await supaStorage.set("meridian-alert-recipients",JSON.stringify(recipients));}catch{}})();},[recipients,loaded]);
  useEffect(()=>{if(!loaded)return;(async()=>{try{await supaStorage.set("meridian-alert-log",JSON.stringify(alertLog));}catch{}})();},[alertLog,loaded]);

  // Evaluate all active rules against current loan data
  const liveAlerts = useMemo(()=>{
    const out=[];
    for(const rule of rules.filter(r=>r.active)){
      const cond=ALERT_CONDITIONS.find(c=>c.id===rule.conditionId);
      if(!cond)continue;
      const targetLoans=rule.loanFilter==="all"?loans:loans.filter(l=>rule.loanIds?.includes(l.id));
      for(const loan of targetLoans){
        try{
          const fires=cond.eval(loan,rule.params||{});
          if(fires){
            const sev=cond.severity(loan,rule.params||{});
            out.push({ruleId:rule.id,ruleName:rule.name,conditionId:rule.conditionId,loan,severity:sev,detail:cond.detail(loan,rule.params||{}),rule,cond,ts:Date.now()});
          }
        }catch{}
      }
    }
    return out.sort((a,b)=>{const o={critical:0,high:1,medium:2,low:3};return(o[a.severity]||4)-(o[b.severity]||4);});
  },[rules,loans]);

  const filteredAlerts = useMemo(()=>liveAlerts.filter(a=>{
    if(filterSeverity!=="all"&&a.severity!==filterSeverity)return false;
    if(searchFilter&&!a.loan.addr.toLowerCase().includes(searchFilter.toLowerCase())&&!a.ruleName.toLowerCase().includes(searchFilter.toLowerCase()))return false;
    return true;
  }),[liveAlerts,filterSeverity,searchFilter]);

  const critCount=liveAlerts.filter(a=>a.severity==="critical").length;
  const highCount=liveAlerts.filter(a=>a.severity==="high").length;

  // Generate AI notification message
  const generateNotification = async(alert,channel)=>{
    setGeneratingMsg(true);
    setGeneratedMsg(null);
    const el=enrich(alert.loan);
    const prompt=`Generate a concise, professional ${channel==="sms"?"SMS text message (under 160 chars)":"email"} notification for a commercial real estate mortgage alert.

Alert Type: ${alert.cond.label}
Property: ${alert.loan.addr}
Lender: ${alert.loan.lender}
Loan Balance: ${f$(el.curBal)}
Rate: ${fPct(alert.loan.rate)} ${alert.loan.loanType}
Maturity: ${fDateF(alert.loan.maturityDate)} (${el.daysLeft>0?el.daysLeft+" days remaining":Math.abs(el.daysLeft)+" days overdue"})
Alert Detail: ${alert.detail}
Severity: ${alert.severity.toUpperCase()}
Rule Name: "${alert.ruleName}"

${channel==="email"?`Write a professional email with:
- Subject line (prefix: [MERIDIAN ALERT])
- Brief greeting
- Clear description of the issue and urgency
- The specific loan details
- A recommended action or next step
- Sign off as "Meridian Properties — Automated Alert System"

Format as:
SUBJECT: [subject line]
BODY:
[email body]`:`Write a single SMS under 160 characters. Be direct. Include property address, issue, and one action. No emojis.`}`;

    try{
      const resp=await fetch("https://api.anthropic.com/v1/messages",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:600,messages:[{role:"user",content:prompt}]})
      });
      const data=await resp.json();
      const text=data.content?.filter(b=>b.type==="text").map(b=>b.text).join("")||"";
      setGeneratedMsg({text,channel,alert});
    }catch(e){setGeneratedMsg({text:`Error generating message: ${e.message}`,error:true});}
    setGeneratingMsg(false);
  };

  // Log a "sent" action
  const logSend=(alert,channel,recipientIds)=>{
    const entry={id:Date.now(),ruleId:alert.ruleId,ruleName:alert.ruleName,loanAddr:alert.loan.addr,severity:alert.severity,detail:alert.detail,channel,recipientIds,ts:new Date().toISOString(),sentBy:"Manual trigger"};
    setAlertLog(p=>[entry,...p].slice(0,200));
  };

  // ── RULE EDITOR ──
  const RuleEditor=({ruleId,onClose})=>{
    const existing=ruleId&&ruleId!=="new"?rules.find(r=>r.id===ruleId):null;
    const [name,setName]=useState(existing?.name||"");
    const [condId,setCondId]=useState(existing?.conditionId||ALERT_CONDITIONS[0].id);
    const [params,setParams]=useState(existing?.params||{});
    const [loanFilter,setLoanFilter]=useState(existing?.loanFilter||"all");
    const [loanIds,setLoanIds]=useState(existing?.loanIds||[]);
    const [channel,setChannel]=useState(existing?.channel||"email");
    const [recipientIds,setRecipientIds]=useState(existing?.recipientIds||[]);
    const [active,setActive]=useState(existing?.active!==false);

    const cond=ALERT_CONDITIONS.find(c=>c.id===condId);

    const save=()=>{
      if(!name.trim()){alert("Please name this alert rule.");return;}
      const rule={id:existing?.id||Date.now(),name:name.trim(),conditionId:condId,params,loanFilter,loanIds,channel,recipientIds,active,createdAt:existing?.createdAt||TODAY_STR,updatedAt:TODAY_STR};
      if(existing){setRules(p=>p.map(r=>r.id===existing.id?rule:r));}
      else{setRules(p=>[...p,rule]);}
      onClose();
    };

    const toggleLoan=id=>setLoanIds(p=>p.includes(id)?p.filter(x=>x!==id):[...p,id]);
    const toggleRec=id=>setRecipientIds(p=>p.includes(id)?p.filter(x=>x!==id):[...p,id]);

    return(<div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.5)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",padding:24}} onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={{background:"var(--white)",borderRadius:18,width:"100%",maxWidth:620,maxHeight:"90vh",overflow:"hidden",display:"flex",flexDirection:"column",boxShadow:"0 24px 64px rgba(0,0,0,.25)"}}>
        <div style={{padding:"18px 24px",borderBottom:"1px solid var(--bd)",display:"flex",justifyContent:"space-between",alignItems:"center",flexShrink:0}}>
          <div style={{fontSize:15,fontWeight:800,color:"var(--t1)"}}>{existing?"Edit Alert Rule":"New Alert Rule"}</div>
          <button onClick={onClose} style={{background:"none",border:"none",fontSize:18,color:"var(--t3)",cursor:"pointer"}}>✕</button>
        </div>
        <div style={{overflowY:"auto",padding:"20px 24px",flex:1,display:"flex",flexDirection:"column",gap:18}}>

          {/* Name */}
          <div>
            <div className="flbl" style={{display:"block",marginBottom:4}}>Rule Name *</div>
            <input className="finp" placeholder="e.g. 90-Day Maturity Warning" value={name} onChange={e=>setName(e.target.value)}/>
          </div>

          {/* Condition picker */}
          <div>
            <div className="flbl" style={{display:"block",marginBottom:8}}>Alert Condition</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
              {ALERT_CONDITIONS.map(c=>(
                <div key={c.id} onClick={()=>{setCondId(c.id);setParams({});}}
                  style={{padding:"10px 12px",borderRadius:10,border:`2px solid ${condId===c.id?"var(--blue)":"var(--bd)"}`,background:condId===c.id?"var(--bbg)":"var(--white)",cursor:"pointer",transition:"all .12s"}}>
                  <div style={{fontSize:13,fontWeight:700,color:condId===c.id?"var(--blue)":"var(--t1)",marginBottom:2}}>{c.icon} {c.label}</div>
                  <div style={{fontSize:10,color:"var(--t3)",lineHeight:1.4}}>{c.desc}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Condition param */}
          {cond?.param&&<div>
            <div className="flbl" style={{display:"block",marginBottom:4}}>{cond.param.label}</div>
            <input className="finp" type={cond.param.type} value={params[cond.param.key]??cond.param.default} onChange={e=>setParams(p=>({...p,[cond.param.key]:parseFloat(e.target.value)||cond.param.default}))} style={{maxWidth:200}}/>
          </div>}

          {/* Loan filter */}
          <div>
            <div className="flbl" style={{display:"block",marginBottom:8}}>Apply to Loans</div>
            <div style={{display:"flex",gap:8,marginBottom:10}}>
              {[["all","All Loans"],["specific","Specific Loans"]].map(([id,lbl])=>(
                <button key={id} onClick={()=>setLoanFilter(id)} style={{padding:"6px 16px",borderRadius:8,border:`1px solid ${loanFilter===id?"var(--t1)":"var(--bd)"}`,background:loanFilter===id?"var(--t1)":"var(--white)",color:loanFilter===id?"#fff":"var(--t3)",fontSize:12,fontWeight:600,cursor:"pointer"}}>{lbl}</button>
              ))}
            </div>
            {loanFilter==="specific"&&<div style={{maxHeight:160,overflowY:"auto",border:"1px solid var(--bd)",borderRadius:10,display:"flex",flexDirection:"column",gap:0}}>
              {loans.map(l=>(
                <label key={l.id} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 12px",borderBottom:"1px solid var(--bd)",cursor:"pointer",background:loanIds.includes(l.id)?"var(--bbg)":"transparent"}}>
                  <input type="checkbox" checked={loanIds.includes(l.id)} onChange={()=>toggleLoan(l.id)} style={{accentColor:"var(--blue)"}}/>
                  <div><div style={{fontSize:11,fontWeight:600,color:"var(--t1)"}}>{l.addr}</div><div style={{fontSize:10,color:"var(--t3)"}}>{l.lender} · {fPct(l.rate)}</div></div>
                </label>
              ))}
            </div>}
          </div>

          {/* Channel */}
          <div>
            <div className="flbl" style={{display:"block",marginBottom:8}}>Notification Channel</div>
            <div style={{display:"flex",gap:8}}>
              {CHANNELS.map(ch=>(
                <button key={ch.id} onClick={()=>setChannel(ch.id)} style={{padding:"7px 16px",borderRadius:8,border:`1px solid ${channel===ch.id?"var(--t1)":"var(--bd)"}`,background:channel===ch.id?"var(--t1)":"var(--white)",color:channel===ch.id?"#fff":"var(--t3)",fontSize:12,fontWeight:600,cursor:"pointer"}}>{ch.icon} {ch.label}</button>
              ))}
            </div>
          </div>

          {/* Recipients */}
          <div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
              <div className="flbl">Recipients</div>
              {recipients.length===0&&<span style={{fontSize:10,color:"var(--amber)"}}>⚠ Add recipients first</span>}
            </div>
            {recipients.length===0?<div style={{fontSize:11,color:"var(--t4)",padding:"10px 0"}}>No recipients configured. Go to the Recipients tab to add contacts.</div>
            :<div style={{display:"flex",flexDirection:"column",gap:4}}>
              {recipients.map(r=>(
                <label key={r.id} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 12px",borderRadius:8,border:"1px solid var(--bd)",cursor:"pointer",background:recipientIds.includes(r.id)?"var(--bbg)":"transparent"}}>
                  <input type="checkbox" checked={recipientIds.includes(r.id)} onChange={()=>toggleRec(r.id)} style={{accentColor:"var(--blue)"}}/>
                  <div><div style={{fontSize:11,fontWeight:600,color:"var(--t1)"}}>{r.name}</div><div style={{fontSize:10,color:"var(--t3)"}}>{r.email}{r.phone?` · ${r.phone}`:""} · {r.role}</div></div>
                </label>
              ))}
            </div>}
          </div>

          {/* Active toggle */}
          <div style={{display:"flex",alignItems:"center",gap:12,padding:"10px 14px",background:"var(--bg)",borderRadius:10}}>
            <div style={{flex:1}}>
              <div style={{fontSize:12,fontWeight:700,color:"var(--t1)"}}>Rule Active</div>
              <div style={{fontSize:10,color:"var(--t3)"}}>Inactive rules won't generate alerts or appear on the dashboard</div>
            </div>
            <div onClick={()=>setActive(s=>!s)} style={{width:44,height:24,borderRadius:12,background:active?"var(--green)":"var(--bd2)",cursor:"pointer",position:"relative",transition:"background .2s",flexShrink:0}}>
              <div style={{width:18,height:18,borderRadius:"50%",background:"#fff",position:"absolute",top:3,left:active?23:3,transition:"left .2s",boxShadow:"0 1px 4px rgba(0,0,0,.2)"}}/>
            </div>
          </div>
        </div>
        <div style={{padding:"14px 24px",borderTop:"1px solid var(--bd)",display:"flex",justifyContent:"flex-end",gap:8,flexShrink:0}}>
          <button className="btn-light" onClick={onClose}>Cancel</button>
          <button className="btn-dark" onClick={save}>{existing?"Save Changes":"Create Rule"}</button>
        </div>
      </div>
    </div>);
  };

  // ── PREVIEW MODAL ──
  const PreviewModal=({alert,onClose})=>{
    const el=enrich(alert.loan);
    const sm=SEVERITY_META[alert.severity];
    const ruleRecipients=recipients.filter(r=>alert.rule.recipientIds?.includes(r.id));

    return(<div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.5)",zIndex:1000,display:"flex",alignItems:"flex-start",justifyContent:"center",padding:24,overflowY:"auto"}} onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={{background:"var(--white)",borderRadius:18,width:"100%",maxWidth:680,overflow:"hidden",boxShadow:"0 24px 64px rgba(0,0,0,.25)",margin:"auto"}}>
        <div style={{padding:"18px 24px",borderBottom:"1px solid var(--bd)",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div>
            <div style={{fontSize:9,fontWeight:800,color:sm.color,textTransform:"uppercase",letterSpacing:".1em",marginBottom:3}}>{sm.label} Alert</div>
            <div style={{fontSize:15,fontWeight:800,color:"var(--t1)"}}>{alert.cond.icon} {alert.cond.label}</div>
          </div>
          <button onClick={onClose} style={{background:"none",border:"none",fontSize:18,color:"var(--t3)",cursor:"pointer"}}>✕</button>
        </div>
        <div style={{padding:"20px 24px",display:"flex",flexDirection:"column",gap:16}}>

          {/* Alert context */}
          <div style={{background:sm.bg,border:`1px solid ${sm.bd}`,borderRadius:12,padding:"14px 16px"}}>
            <div style={{fontSize:13,fontWeight:700,color:sm.color,marginBottom:4}}>{alert.loan.addr}</div>
            <div style={{fontSize:12,color:"var(--t2)",marginBottom:8}}>{alert.detail}</div>
            <div style={{display:"flex",gap:20,fontSize:11,color:"var(--t3)"}}>
              <span>Balance: <strong style={{color:"var(--t1)"}}>{f$(el.curBal)}</strong></span>
              <span>Rate: <strong style={{color:"var(--t1)"}}>{fPct(alert.loan.rate)} {alert.loan.loanType}</strong></span>
              <span>Maturity: <strong style={{color:el.daysLeft<90?"var(--red)":"var(--t1)"}}>{fDateF(alert.loan.maturityDate)}</strong></span>
            </div>
          </div>

          {/* Recipients */}
          {ruleRecipients.length>0&&<div>
            <div style={{fontSize:11,fontWeight:700,color:"var(--t3)",textTransform:"uppercase",letterSpacing:".07em",marginBottom:8}}>Configured Recipients</div>
            <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
              {ruleRecipients.map(r=>(
                <div key={r.id} style={{padding:"5px 12px",background:"var(--bg)",border:"1px solid var(--bd)",borderRadius:20,fontSize:11,color:"var(--t2)"}}>
                  {r.name} <span style={{color:"var(--t4)"}}>({alert.rule.channel==="sms"?r.phone||r.email:r.email})</span>
                </div>
              ))}
            </div>
          </div>}

          {/* Generate message */}
          <div style={{borderTop:"1px solid var(--bd)",paddingTop:16}}>
            <div style={{fontSize:13,fontWeight:700,color:"var(--t1)",marginBottom:10}}>Generate Notification Message</div>
            <div style={{display:"flex",gap:8,marginBottom:12}}>
              {CHANNELS.map(ch=>(
                <button key={ch.id} onClick={()=>generateNotification(alert,ch.id==="both"?"email":ch.id)} disabled={generatingMsg}
                  style={{padding:"7px 16px",background:"var(--bg)",border:"1px solid var(--bd2)",borderRadius:9,fontSize:11,color:"var(--t2)",cursor:"pointer",fontWeight:600,transition:"all .12s"}}
                  onMouseEnter={e=>{e.currentTarget.style.borderColor="var(--blue)";}}
                  onMouseLeave={e=>{e.currentTarget.style.borderColor="var(--bd2);";}}>
                  {generatingMsg?"⏳ Generating…":`${ch.icon} Draft ${ch.label}`}
                </button>
              ))}
            </div>

            {generatedMsg&&!generatedMsg.error&&<>
              <div style={{background:"var(--bg)",border:"1px solid var(--bd)",borderRadius:12,overflow:"hidden"}}>
                <div style={{padding:"10px 14px",borderBottom:"1px solid var(--bd)",display:"flex",justifyContent:"space-between",alignItems:"center",background:"var(--white)"}}>
                  <div style={{fontSize:11,fontWeight:700,color:"var(--t2)"}}>
                    {generatedMsg.channel==="sms"?"📱 SMS Draft":"✉️ Email Draft"} — AI Generated
                  </div>
                  <button onClick={()=>navigator.clipboard?.writeText(generatedMsg.text)} style={{padding:"3px 10px",background:"var(--t1)",border:"none",borderRadius:6,fontSize:10,color:"#fff",cursor:"pointer",fontWeight:600}}>Copy</button>
                </div>
                <pre style={{padding:"14px 16px",fontSize:11,color:"var(--t1)",lineHeight:1.7,whiteSpace:"pre-wrap",fontFamily:"inherit",maxHeight:280,overflowY:"auto"}}>{generatedMsg.text}</pre>
              </div>

              {/* Send options */}
              {ruleRecipients.length>0&&<div style={{marginTop:10,display:"flex",gap:8,flexWrap:"wrap"}}>
                {ruleRecipients.map(r=>(
                  <div key={r.id} style={{display:"flex",gap:6}}>
                    {(alert.rule.channel==="email"||alert.rule.channel==="both")&&r.email&&<a
                      href={`mailto:${r.email}?subject=${encodeURIComponent(generatedMsg.text.match(/SUBJECT:\s*(.+)/)?.[1]||"[MERIDIAN ALERT]")}&body=${encodeURIComponent(generatedMsg.text.replace(/SUBJECT:.+\nBODY:\n/s,""))}`}
                      onClick={()=>logSend(alert,alert.rule.channel,[r.id])}
                      style={{padding:"6px 14px",background:"var(--t1)",borderRadius:8,fontSize:11,color:"#fff",textDecoration:"none",fontWeight:600,display:"inline-flex",alignItems:"center",gap:5}}>
                      ✉️ Send to {r.name}
                    </a>}
                    {(alert.rule.channel==="sms"||alert.rule.channel==="both")&&r.phone&&<a
                      href={`sms:${r.phone}?body=${encodeURIComponent(generatedMsg.text)}`}
                      onClick={()=>logSend(alert,alert.rule.channel,[r.id])}
                      style={{padding:"6px 14px",background:"#16a34a",borderRadius:8,fontSize:11,color:"#fff",textDecoration:"none",fontWeight:600,display:"inline-flex",alignItems:"center",gap:5}}>
                      📱 Text {r.name}
                    </a>}
                  </div>
                ))}
              </div>}
            </>}
          </div>
        </div>
      </div>
    </div>);
  };

  // ── RECIPIENT MANAGER ──
  const RecipientForm=()=>{
    const [name,setName]=useState("");
    const [email,setEmail]=useState("");
    const [phone,setPhone]=useState("");
    const [role,setRole]=useState("Property Manager");
    const add=()=>{
      if(!name||(!email&&!phone)){alert("Name and at least one contact method required.");return;}
      setRecipients(p=>[...p,{id:Date.now(),name,email,phone,role}]);
      setName("");setEmail("");setPhone("");setRole("Property Manager");
    };
    return(<div style={{background:"var(--white)",border:"1px solid var(--bd)",borderRadius:14,padding:"16px 20px",marginBottom:16}}>
      <div style={{fontSize:13,fontWeight:700,color:"var(--t1)",marginBottom:12}}>Add Recipient</div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
        <div><div className="flbl" style={{display:"block",marginBottom:3}}>Name *</div><input className="finp" value={name} onChange={e=>setName(e.target.value)} placeholder="Maria Lopez"/></div>
        <div><div className="flbl" style={{display:"block",marginBottom:3}}>Role</div><select className="finp" value={role} onChange={e=>setRole(e.target.value)}>{["Owner","Property Manager","Asset Manager","Accountant","Lender Contact","Attorney","Other"].map(r=><option key={r}>{r}</option>)}</select></div>
        <div><div className="flbl" style={{display:"block",marginBottom:3}}>Email</div><input className="finp" type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="maria@meridian.com"/></div>
        <div><div className="flbl" style={{display:"block",marginBottom:3}}>Phone (for SMS)</div><input className="finp" type="tel" value={phone} onChange={e=>setPhone(e.target.value)} placeholder="+1 718 555 0100"/></div>
      </div>
      <button className="btn-dark" onClick={add} style={{fontSize:12}}>+ Add Recipient</button>
    </div>);
  };

  return(<div>
    {/* Header */}
    <div style={{marginBottom:20}}>
      <div style={{fontSize:22,fontWeight:700,color:"var(--t1)",marginBottom:4}}>Alert System</div>
      <div style={{fontSize:13,color:"var(--t3)"}}>Configure rules, manage recipients, and generate email/SMS notifications when debt events occur.</div>
    </div>

    {/* Live alert banner */}
    {critCount>0&&<div style={{background:"var(--rbg)",border:"1px solid var(--rbd)",borderRadius:12,padding:"12px 18px",marginBottom:16,display:"flex",alignItems:"center",gap:14}}>
      <div style={{fontSize:24,flexShrink:0}}>🚨</div>
      <div style={{flex:1}}>
        <div style={{fontSize:13,fontWeight:800,color:"var(--red)"}}>
          {critCount} CRITICAL ALERT{critCount!==1?"S":""} — ACTION REQUIRED
        </div>
        <div style={{fontSize:11,color:"var(--t2)",marginTop:2}}>
          {liveAlerts.filter(a=>a.severity==="critical").slice(0,3).map(a=>a.loan.addr).join(", ")}{critCount>3?` +${critCount-3} more`:""}
        </div>
      </div>
      <button className="btn-dark" onClick={()=>setActiveTab("dashboard")} style={{background:"var(--red)",fontSize:12,flexShrink:0}}>View Alerts</button>
    </div>}

    {/* Tab bar */}
    <div style={{display:"flex",gap:2,marginBottom:20,background:"var(--white)",border:"1px solid var(--bd)",borderRadius:11,padding:3,width:"fit-content"}}>
      {[
        {id:"dashboard",label:`🔔 Live Alerts${liveAlerts.length>0?` (${liveAlerts.length})`:""}`,badge:critCount+highCount},
        {id:"rules",label:`⚙️ Rules (${rules.length})`},
        {id:"recipients",label:`👥 Recipients (${recipients.length})`},
        {id:"log",label:`📋 Send Log (${alertLog.length})`},
      ].map(t=>(
        <button key={t.id} onClick={()=>setActiveTab(t.id)} style={{
          padding:"7px 16px",borderRadius:8,border:"none",fontSize:12,fontWeight:activeTab===t.id?700:400,
          background:activeTab===t.id?"var(--t1)":"transparent",
          color:activeTab===t.id?"#fff":"var(--t3)",cursor:"pointer",position:"relative",whiteSpace:"nowrap",
        }}>
          {t.label}
          {t.id==="dashboard"&&(critCount>0)&&<span style={{position:"absolute",top:4,right:4,width:7,height:7,background:"var(--red)",borderRadius:"50%"}}/>}
        </button>
      ))}
    </div>

    {/* ── DASHBOARD TAB ── */}
    {activeTab==="dashboard"&&<>
      {/* Summary KPIs */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:20}}>
        {Object.entries(SEVERITY_META).map(([sev,m])=>{
          const cnt=liveAlerts.filter(a=>a.severity===sev).length;
          return(<div key={sev} style={{background:m.bg,border:`1px solid ${m.bd}`,borderRadius:12,padding:"14px 16px",cursor:cnt>0?"pointer":"default"}} onClick={()=>{if(cnt>0){setFilterSeverity(sev);}}}>
            <div style={{fontSize:9,fontWeight:800,color:m.color,textTransform:"uppercase",letterSpacing:".08em",marginBottom:6}}>{m.label}</div>
            <div style={{fontSize:28,fontWeight:800,color:m.color,lineHeight:1}}>{cnt}</div>
          </div>);
        })}
      </div>

      {/* Filters */}
      <div style={{display:"flex",gap:8,marginBottom:16,alignItems:"center",flexWrap:"wrap"}}>
        <input value={searchFilter} onChange={e=>setSearchFilter(e.target.value)} placeholder="Search property or rule…" style={{flex:1,minWidth:180,maxWidth:280,padding:"7px 12px",border:"1px solid var(--bd)",borderRadius:9,fontSize:12,color:"var(--t1)",background:"var(--white)",outline:"none"}}/>
        <div style={{display:"flex",gap:4}}>
          {["all","critical","high","medium","low"].map(s=>(
            <button key={s} onClick={()=>setFilterSeverity(s)} style={{padding:"5px 12px",borderRadius:20,border:"1px solid",fontSize:10,fontWeight:filterSeverity===s?800:500,cursor:"pointer",
              background:filterSeverity===s?(s==="all"?"var(--t1)":SEVERITY_META[s]?.bg||"var(--bg)"):"var(--white)",
              color:filterSeverity===s?(s==="all"?"#fff":SEVERITY_META[s]?.color||"var(--t1)"):"var(--t3)",
              borderColor:filterSeverity===s?(s==="all"?"var(--t1)":SEVERITY_META[s]?.bd||"var(--bd)"):"var(--bd)",
            }}>{s==="all"?"All":s.charAt(0).toUpperCase()+s.slice(1)}</button>
          ))}
        </div>
        {rules.filter(r=>r.active).length===0&&<span style={{fontSize:11,color:"var(--amber)"}}>⚠ No active rules — go to Rules tab to set up alerts</span>}
      </div>

      {filteredAlerts.length===0?<div style={{background:"var(--white)",border:"2px dashed var(--bd2)",borderRadius:16,padding:"48px 32px",textAlign:"center"}}>
        <div style={{fontSize:32,opacity:.2,marginBottom:10}}>{rules.filter(r=>r.active).length===0?"⚙️":"✅"}</div>
        <div style={{fontSize:15,fontWeight:700,color:"var(--t3)",marginBottom:6}}>
          {rules.filter(r=>r.active).length===0?"No active alert rules configured":"No alerts triggered — all clear"}
        </div>
        <div style={{fontSize:12,color:"var(--t4)",marginBottom:16}}>
          {rules.filter(r=>r.active).length===0?"Create rules in the Rules tab to start monitoring your portfolio":"Your portfolio meets all configured alert thresholds"}
        </div>
        {rules.filter(r=>r.active).length===0&&<button className="btn-dark" onClick={()=>setActiveTab("rules")}>+ Create First Rule</button>}
      </div>:<div style={{display:"flex",flexDirection:"column",gap:8}}>
        {filteredAlerts.map((a,i)=>{
          const sm=SEVERITY_META[a.severity];
          const el=enrich(a.loan);
          const ruleRecs=recipients.filter(r=>a.rule.recipientIds?.includes(r.id));
          return(<div key={i} style={{background:"var(--white)",border:`1px solid ${sm.bd}`,borderLeft:`3px solid ${sm.color}`,borderRadius:12,padding:"13px 16px",display:"flex",alignItems:"flex-start",gap:14,cursor:"pointer",transition:"box-shadow .1s"}}
            onMouseEnter={e=>e.currentTarget.style.boxShadow="0 4px 14px rgba(0,0,0,.07)"}
            onMouseLeave={e=>e.currentTarget.style.boxShadow=""}>
            <div style={{marginTop:1,flexShrink:0}}>
              <span style={{fontSize:9,fontWeight:800,padding:"3px 9px",borderRadius:20,background:sm.color,color:"#fff",letterSpacing:".07em",whiteSpace:"nowrap"}}>{sm.label}</span>
            </div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{display:"flex",alignItems:"baseline",gap:10,marginBottom:2,flexWrap:"wrap"}}>
                <div style={{fontSize:13,fontWeight:700,color:"var(--t1)"}}>{a.loan.addr}</div>
                <div style={{fontSize:10,color:"var(--t3)"}}>{a.cond.icon} {a.cond.label}</div>
              </div>
              <div style={{fontSize:11,color:"var(--t2)",marginBottom:6}}>{a.detail}</div>
              <div style={{display:"flex",gap:16,fontSize:10,color:"var(--t4)",flexWrap:"wrap"}}>
                <span>Rule: <strong style={{color:"var(--t3)"}}>{a.ruleName}</strong></span>
                <span>{f$(el.curBal)}</span>
                <span>{fPct(a.loan.rate)} {a.loan.loanType}</span>
                <span>Matures {fDateS(a.loan.maturityDate)}</span>
                {ruleRecs.length>0&&<span>→ {ruleRecs.map(r=>r.name).join(", ")}</span>}
              </div>
            </div>
            <button onClick={()=>setPreviewAlert(a)} style={{padding:"6px 14px",background:"var(--t1)",border:"none",borderRadius:8,fontSize:11,color:"#fff",cursor:"pointer",fontWeight:700,flexShrink:0,whiteSpace:"nowrap"}}>
              📣 Notify
            </button>
          </div>);
        })}
      </div>}
    </>}

    {/* ── RULES TAB ── */}
    {activeTab==="rules"&&<>
      <div style={{display:"flex",justifyContent:"flex-end",marginBottom:14}}>
        <button className="btn-dark" onClick={()=>setEditRule("new")}>+ New Alert Rule</button>
      </div>
      {rules.length===0?<div style={{background:"var(--white)",border:"2px dashed var(--bd2)",borderRadius:16,padding:"48px 32px",textAlign:"center"}}>
        <div style={{fontSize:32,opacity:.2,marginBottom:10}}>⚙️</div>
        <div style={{fontSize:15,fontWeight:700,color:"var(--t3)",marginBottom:8}}>No alert rules yet</div>
        <div style={{fontSize:12,color:"var(--t4)",marginBottom:16}}>Create rules to monitor maturities, DSCR covenants, rate caps, and more across your entire portfolio.</div>
        <button className="btn-dark" onClick={()=>setEditRule("new")}>+ Create First Rule</button>
      </div>:<div style={{display:"flex",flexDirection:"column",gap:8}}>
        {rules.map(rule=>{
          const cond=ALERT_CONDITIONS.find(c=>c.id===rule.conditionId);
          const activeAlerts=liveAlerts.filter(a=>a.ruleId===rule.id);
          const ruleRecs=recipients.filter(r=>rule.recipientIds?.includes(r.id));
          return(<div key={rule.id} style={{background:"var(--white)",border:"1px solid var(--bd)",borderRadius:12,padding:"13px 18px",display:"flex",alignItems:"center",gap:14,opacity:rule.active?1:.55}}>
            <div style={{width:10,height:10,borderRadius:"50%",background:rule.active?"var(--green)":"var(--bd2)",flexShrink:0}}/>
            <div style={{flex:1}}>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:3,flexWrap:"wrap"}}>
                <div style={{fontSize:13,fontWeight:700,color:"var(--t1)"}}>{rule.name}</div>
                {activeAlerts.length>0&&<span style={{fontSize:9,fontWeight:800,padding:"2px 8px",borderRadius:10,background:"var(--rbg)",color:"var(--red)",border:"1px solid var(--rbd)"}}>{activeAlerts.length} ACTIVE</span>}
              </div>
              <div style={{fontSize:11,color:"var(--t3)",marginBottom:3}}>{cond?.icon} {cond?.label} · {rule.loanFilter==="all"?"All loans":`${rule.loanIds?.length||0} specific loans`}</div>
              <div style={{fontSize:10,color:"var(--t4)"}}>{CHANNELS.find(c=>c.id===rule.channel)?.icon} {CHANNELS.find(c=>c.id===rule.channel)?.label} {ruleRecs.length>0?`→ ${ruleRecs.map(r=>r.name).join(", ")}`:"(no recipients)"}</div>
            </div>
            <div style={{display:"flex",gap:6}}>
              <button onClick={()=>setRules(p=>p.map(r=>r.id===rule.id?{...r,active:!r.active}:r))} style={{padding:"5px 12px",background:"var(--bg)",border:"1px solid var(--bd)",borderRadius:8,fontSize:11,color:"var(--t3)",cursor:"pointer"}}>
                {rule.active?"Pause":"Activate"}
              </button>
              <button onClick={()=>setEditRule(rule.id)} style={{padding:"5px 12px",background:"var(--bbg)",border:"1px solid var(--bbd)",borderRadius:8,fontSize:11,color:"var(--blue)",cursor:"pointer",fontWeight:600}}>Edit</button>
              <button onClick={()=>{if(window.confirm(`Delete "${rule.name}"?`))setRules(p=>p.filter(r=>r.id!==rule.id));}} style={{padding:"5px 10px",background:"var(--rbg)",border:"1px solid var(--rbd)",borderRadius:8,fontSize:11,color:"var(--red)",cursor:"pointer"}}>✕</button>
            </div>
          </div>);
        })}
      </div>}
    </>}

    {/* ── RECIPIENTS TAB ── */}
    {activeTab==="recipients"&&<>
      <RecipientForm/>
      {recipients.length===0?<div style={{textAlign:"center",padding:"32px",color:"var(--t4)",fontSize:13}}>No recipients yet. Add contacts above to start routing notifications.</div>
      :<div style={{display:"flex",flexDirection:"column",gap:8}}>
        {recipients.map(r=>(
          <div key={r.id} style={{background:"var(--white)",border:"1px solid var(--bd)",borderRadius:12,padding:"13px 18px",display:"flex",alignItems:"center",gap:14}}>
            <div style={{width:36,height:36,borderRadius:"50%",background:"linear-gradient(135deg,#3b82f6,#8b5cf6)",display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontSize:14,fontWeight:700,flexShrink:0}}>{r.name[0]}</div>
            <div style={{flex:1}}>
              <div style={{fontSize:13,fontWeight:700,color:"var(--t1)",marginBottom:2}}>{r.name} <span style={{fontSize:10,fontWeight:400,color:"var(--t4)"}}>· {r.role}</span></div>
              {r.email&&<div style={{fontSize:11,color:"var(--t3)"}}>✉️ {r.email}</div>}
              {r.phone&&<div style={{fontSize:11,color:"var(--t3)"}}>📱 {r.phone}</div>}
            </div>
            <div style={{fontSize:10,color:"var(--t4)"}}>{rules.filter(rule=>rule.recipientIds?.includes(r.id)).length} rule{rules.filter(rule=>rule.recipientIds?.includes(r.id)).length!==1?"s":""}</div>
            <button onClick={()=>setRecipients(p=>p.filter(x=>x.id!==r.id))} style={{padding:"5px 10px",background:"var(--rbg)",border:"1px solid var(--rbd)",borderRadius:8,fontSize:11,color:"var(--red)",cursor:"pointer"}}>✕</button>
          </div>
        ))}
      </div>}
    </>}

    {/* ── LOG TAB ── */}
    {activeTab==="log"&&<>
      <div style={{display:"flex",justifyContent:"flex-end",marginBottom:12}}>
        {alertLog.length>0&&<button onClick={()=>{if(window.confirm("Clear the entire send log?"))setAlertLog([]);}} style={{padding:"5px 14px",background:"var(--rbg)",border:"1px solid var(--rbd)",borderRadius:8,fontSize:11,color:"var(--red)",cursor:"pointer",fontWeight:600}}>Clear Log</button>}
      </div>
      {alertLog.length===0?<div style={{textAlign:"center",padding:"48px",color:"var(--t4)",fontSize:13}}>
        <div style={{fontSize:28,opacity:.15,marginBottom:8}}>📋</div>
        No notifications sent yet. Trigger notifications from the Live Alerts tab.
      </div>:<div style={{display:"flex",flexDirection:"column",gap:6}}>
        {alertLog.map(entry=>{
          const sm=SEVERITY_META[entry.severity];
          return(<div key={entry.id} style={{background:"var(--white)",border:"1px solid var(--bd)",borderRadius:10,padding:"11px 16px",display:"flex",alignItems:"center",gap:14}}>
            <span style={{fontSize:9,fontWeight:800,padding:"2px 8px",borderRadius:10,background:sm?.color||"var(--t4)",color:"#fff",letterSpacing:".07em",flexShrink:0}}>{(sm?.label||entry.severity).toUpperCase()}</span>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:12,fontWeight:600,color:"var(--t1)",marginBottom:1}}>{entry.loanAddr}</div>
              <div style={{fontSize:10,color:"var(--t3)"}}>{entry.detail}</div>
            </div>
            <div style={{fontSize:10,color:"var(--t4)",textAlign:"right",flexShrink:0}}>
              <div>{CHANNELS.find(c=>c.id===entry.channel)?.icon} {entry.channel}</div>
              <div>{fDateF(entry.ts.slice(0,10))}</div>
            </div>
          </div>);
        })}
      </div>}
    </>}

    {/* Modals */}
    {editRule&&<RuleEditor ruleId={editRule} onClose={()=>setEditRule(null)}/>}
    {previewAlert&&<PreviewModal alert={previewAlert} onClose={()=>{setPreviewAlert(null);setGeneratedMsg(null);setGeneratingMsg(false);}}/>}
  </div>);
}


function LoanDocAbstract({loans,onSelect}){
  const [selId,setSelId]=useState(String(loans[0]?.id||""));
  const [docMeta,setDocMeta]=useState({});   // {loanId:[{id,name,size,pages,uploadedAt}]}
  const [chat,setChat]=useState({});          // {loanId:[{role,content,ts}]}
  const [loaded,setLoaded]=useState(false);
  const [tab,setTab]=useState("docs");
  const [input,setInput]=useState("");
  const [thinking,setThinking]=useState(false);
  const [uploading,setUploading]=useState(false);
  const [dragOver,setDragOver]=useState(false);
  const chatEndRef=React.useRef(null);
  const fileInputRef=React.useRef(null);

  // Load metadata + chat from storage (docs stored individually by id)
  useEffect(()=>{(async()=>{
    try{
      const m=await supaStorage.get("meridian-adocmeta");
      if(m?.value)setDocMeta(JSON.parse(m.value));
      const c=await supaStorage.get("meridian-achat");
      if(c?.value)setChat(JSON.parse(c.value));
    }catch{}
    setLoaded(true);
  })();},[]);
  useEffect(()=>{if(!loaded)return;(async()=>{try{await supaStorage.set("meridian-adocmeta",JSON.stringify(docMeta));}catch{}})();},[docMeta,loaded]);
  useEffect(()=>{if(!loaded)return;(async()=>{try{await supaStorage.set("meridian-achat",JSON.stringify(chat));}catch{}})();},[chat,loaded]);
  useEffect(()=>{chatEndRef.current?.scrollIntoView({behavior:"smooth"});},[chat,selId,tab]);

  const sel=loans.find(l=>String(l.id)===selId);
  const el=sel?enrich(sel):null;
  const myDocs=docMeta[selId]||[];
  const myChat=chat[selId]||[];

  // Upload handler
  const handleFiles=async files=>{
    const arr=Array.from(files).filter(f=>f.type==="application/pdf"||f.name.endsWith(".pdf"));
    if(!arr.length){alert("Please upload PDF files only.");return;}
    setUploading(true);
    for(const file of arr){
      if(file.size>4.5*1024*1024){alert(`${file.name} exceeds 4.5MB limit. Please compress before uploading.`);continue;}
      const docId=`doc_${Date.now()}_${Math.random().toString(36).slice(2,7)}`;
      const b64=await new Promise((res,rej)=>{
        const r=new FileReader();
        r.onload=e=>res(e.target.result.split(",")[1]);
        r.onerror=rej;
        r.readAsDataURL(file);
      });
      // Store base64 data by docId
      try{await supaStorage.set(`meridian-adoc-${docId}`,b64);}
      catch{alert(`Could not store ${file.name} — file may be too large.`);continue;}
      // Add metadata
      setDocMeta(p=>({...p,[selId]:[...(p[selId]||[]),{id:docId,name:file.name,size:file.size,uploadedAt:new Date().toISOString().slice(0,10)}]}));
    }
    setUploading(false);
  };

  const deleteDoc=async docId=>{
    try{await supaStorage.delete(`meridian-adoc-${docId}`);}catch{}
    setDocMeta(p=>({...p,[selId]:(p[selId]||[]).filter(d=>d.id!==docId)}));
  };

  const clearChat=()=>setChat(p=>({...p,[selId]:[]}));

  // Send message to AI
  const sendMessage=async(userText)=>{
    const msg=userText||input.trim();
    if(!msg||thinking)return;
    if(myDocs.length===0){alert("Upload at least one loan document first.");return;}
    setInput("");
    const userMsg={role:"user",content:msg,ts:Date.now()};
    setChat(p=>({...p,[selId]:[...(p[selId]||[]),userMsg]}));
    setThinking(true);
    setTab("chat");

    try{
      // Load all doc base64 data
      const docData=[];
      for(const d of myDocs){
        try{
          const r=await supaStorage.get(`meridian-adoc-${d.id}`);
          if(r?.value)docData.push({...d,data:r.value});
        }catch{}
      }

      // Build loan context string
      const loanCtx=sel?`
Loan: ${sel.addr}
Lender: ${sel.lender} (${sel.lenderType})
Type: ${sel.loanType} | Rate: ${fPct(sel.rate)} | Balance: ${f$(el.origBalance)}
Maturity: ${sel.maturityDate} | Term: ${sel.termYears}yr | Amort: ${sel.amortYears||"IO"}yr
Prepay: ${sel.prepay||"None"} | Recourse: ${sel.recourse?"Yes":"Non-Recourse"}
${sel.annualNOI?`NOI: ${f$(sel.annualNOI)} | DSCR: ${el.dscr?.toFixed(2)+"x" || "—"}`:""}
${sel.dscrCovenant?`Covenant: ${sel.dscrCovenant}x`:""}
${sel.notes?`Notes: ${sel.notes}`:""}`.trim():"";

      // System prompt
      const systemPrompt=`You are a specialized mortgage loan analyst for Meridian Properties, a Brooklyn multifamily portfolio. You have been given the loan documents for ${sel?.addr||"this property"} and full access to the loan data below.

${loanCtx}

You can:
- Extract and summarize key loan terms directly from the documents
- Flag risks, unusual clauses, covenants, triggers, or springing recourse provisions
- Compare what the documents say vs. what's recorded in the system
- Answer specific questions about interest calculations, prepayment language, default provisions, extension options
- Surface anything the borrower should know before maturity or refinancing

Be precise. Quote specific document language when relevant. Flag discrepancies between the uploaded documents and recorded loan data.`;

      // Build messages: docs as first user turn context, then history, then new message
      const historyPairs=(myChat).slice(-8); // last 8 messages for context window
      const contentBlocks=[
        ...docData.map(d=>({type:"document",source:{type:"base64",media_type:"application/pdf",data:d.data}})),
        {type:"text",text:`[Loan documents loaded: ${docData.map(d=>d.name).join(", ")}]\n\nUser question: ${msg}`}
      ];

      const messages=[
        {role:"user",content:contentBlocks},
        // If there's prior conversation, inject it as context after the docs
        ...(historyPairs.length>0?[{
          role:"assistant",
          content:`I have reviewed the loan documents (${docData.map(d=>d.name).join(", ")}) for ${sel?.addr}. I'm ready to answer your questions about this loan.`
        }]:[]),
        ...historyPairs.slice(historyPairs.length>0?0:0).reduce((acc,m,i,arr)=>{
          // Re-inject conversation turns without the docs
          if(i===arr.length-1)return acc; // skip last user message, already in contentBlocks
          if(m.role==="user"&&i<arr.length-1)return[...acc,{role:"user",content:m.content}];
          if(m.role==="assistant")return[...acc,{role:"assistant",content:m.content}];
          return acc;
        },[]),
      ];

      const resp=await fetch("https://api.anthropic.com/v1/messages",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          model:"claude-sonnet-4-20250514",
          max_tokens:1000,
          system:systemPrompt,
          messages,
        })
      });
      const data=await resp.json();
      const aiText=data.content?.filter(b=>b.type==="text").map(b=>b.text).join("\n")||"I couldn't generate a response. Please try again.";
      const aiMsg={role:"assistant",content:aiText,ts:Date.now()};
      setChat(p=>({...p,[selId]:[...(p[selId]||[]),aiMsg]}));
    }catch(e){
      const errMsg={role:"assistant",content:`Error: ${e.message||"Something went wrong. Please try again."}`,ts:Date.now(),error:true};
      setChat(p=>({...p,[selId]:[...(p[selId]||[]),errMsg]}));
    }
    setThinking(false);
  };

  const SUGGESTED=[
    "Summarize the key loan terms from the documents",
    "What are the prepayment provisions and exact penalty calculation?",
    "Are there any financial covenants or reporting requirements?",
    "What events could trigger a default or springing recourse?",
    "What are the extension option requirements and conditions?",
    "Flag any unusual or risky clauses I should be aware of",
    "What does the document say about permitted transfers or assumptions?",
    "Compare the document terms to what's recorded in the system",
  ];

  const fSize=b=>b>1e6?`${(b/1e6).toFixed(1)}MB`:`${Math.round(b/1024)}KB`;

  if(loans.length===0)return(<div style={{padding:"64px 40px",textAlign:"center"}}>
    <div style={{fontSize:32,opacity:.2,marginBottom:12}}>📄</div>
    <div style={{fontSize:16,fontWeight:700,color:"var(--t3)"}}>Add loans first to start uploading documents.</div>
  </div>);

  return(<div style={{display:"grid",gridTemplateColumns:"240px 1fr",gap:0,height:"calc(100vh - 58px - 48px)",minHeight:500}}>

    {/* ── LEFT: Loan selector ── */}
    <div style={{borderRight:"1px solid var(--bd)",background:"var(--white)",display:"flex",flexDirection:"column",overflow:"hidden"}}>
      <div style={{padding:"12px 14px",borderBottom:"1px solid var(--bd)",background:"var(--bg)"}}>
        <div style={{fontSize:10,fontWeight:800,color:"var(--t3)",textTransform:"uppercase",letterSpacing:".1em",marginBottom:2}}>Select Loan</div>
        <div style={{fontSize:11,color:"var(--t4)"}}>{loans.length} properties</div>
      </div>
      <div style={{flex:1,overflowY:"auto"}}>
        {loans.map(l=>{
          const cnt=(docMeta[String(l.id)]||[]).length;
          const msgs=(chat[String(l.id)]||[]).length;
          const isActive=String(l.id)===selId;
          const el2=enrich(l);
          return(<div key={l.id} onClick={()=>setSelId(String(l.id))}
            style={{padding:"11px 14px",cursor:"pointer",borderBottom:"1px solid var(--bd)",borderLeft:`3px solid ${isActive?"var(--blue)":"transparent"}`,background:isActive?"var(--bbg)":"transparent",transition:"all .1s"}}>
            <div style={{fontSize:11,fontWeight:700,color:isActive?"var(--blue)":"var(--t1)",marginBottom:3,lineHeight:1.3}}>{l.addr}</div>
            <div style={{fontSize:10,color:"var(--t3)",marginBottom:4}}>{l.lender} · {fPct(l.rate)}</div>
            <div style={{display:"flex",gap:8}}>
              <span style={{fontSize:9,padding:"2px 7px",borderRadius:10,background:cnt>0?"var(--bbg)":"var(--bg)",color:cnt>0?"var(--blue)":"var(--t4)",border:`1px solid ${cnt>0?"var(--bbd)":"var(--bd)"}`,fontWeight:600}}>
                📄 {cnt} doc{cnt!==1?"s":""}
              </span>
              {msgs>0&&<span style={{fontSize:9,padding:"2px 7px",borderRadius:10,background:"var(--gbg)",color:"var(--green)",border:"1px solid var(--gbd)",fontWeight:600}}>
                💬 {msgs}
              </span>}
            </div>
          </div>);
        })}
      </div>
    </div>

    {/* ── RIGHT: Docs + Chat ── */}
    <div style={{display:"flex",flexDirection:"column",overflow:"hidden",background:"var(--bg)"}}>

      {/* Header */}
      {sel&&<div style={{padding:"14px 20px",borderBottom:"1px solid var(--bd)",background:"var(--white)",display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0}}>
        <div>
          <div style={{fontSize:15,fontWeight:800,color:"var(--t1)"}}>{sel.addr}</div>
          <div style={{fontSize:11,color:"var(--t3)"}}>{sel.lender} · {fPct(sel.rate)} {sel.loanType} · Matures {fDateS(sel.maturityDate)}</div>
        </div>
        <div style={{display:"flex",gap:6}}>
          {/* Tab toggle */}
          <div style={{display:"flex",gap:2,background:"var(--bg)",border:"1px solid var(--bd)",borderRadius:9,padding:2}}>
            {[["docs",`📄 Documents (${myDocs.length})`],["chat","🤖 AI Chat"]].map(([id,lbl])=>(
              <button key={id} onClick={()=>setTab(id)} style={{padding:"6px 14px",borderRadius:7,border:"none",fontSize:11,fontWeight:tab===id?700:400,background:tab===id?"var(--t1)":"transparent",color:tab===id?"#fff":"var(--t3)",cursor:"pointer",whiteSpace:"nowrap"}}>{lbl}</button>
            ))}
          </div>
          {tab==="chat"&&myChat.length>0&&<button onClick={clearChat} style={{padding:"6px 12px",background:"var(--rbg)",border:"1px solid var(--rbd)",borderRadius:9,fontSize:11,color:"var(--red)",cursor:"pointer",fontWeight:600}}>Clear Chat</button>}
        </div>
      </div>}

      {/* ── DOCS TAB ── */}
      {tab==="docs"&&<div style={{flex:1,overflowY:"auto",padding:20}}>

        {/* Drop zone */}
        <div
          onDragOver={e=>{e.preventDefault();setDragOver(true);}}
          onDragLeave={()=>setDragOver(false)}
          onDrop={e=>{e.preventDefault();setDragOver(false);handleFiles(e.dataTransfer.files);}}
          onClick={()=>fileInputRef.current?.click()}
          style={{border:`2px dashed ${dragOver?"var(--blue)":"var(--bd2)"}`,borderRadius:14,padding:"36px 24px",textAlign:"center",cursor:"pointer",marginBottom:20,background:dragOver?"var(--bbg)":"var(--white)",transition:"all .15s"}}>
          <input ref={fileInputRef} type="file" accept=".pdf,application/pdf" multiple style={{display:"none"}} onChange={e=>handleFiles(e.target.files)}/>
          <div style={{fontSize:32,marginBottom:10,opacity:.4}}>{uploading?"⏳":"📤"}</div>
          <div style={{fontSize:14,fontWeight:700,color:"var(--t1)",marginBottom:4}}>{uploading?"Uploading…":"Drop PDFs here or click to upload"}</div>
          <div style={{fontSize:11,color:"var(--t3)"}}>Loan agreements, notes, appraisals, title policies, environmental — any PDF up to 4.5MB</div>
        </div>

        {/* Doc list */}
        {myDocs.length===0?<div style={{textAlign:"center",padding:"32px",color:"var(--t4)",fontSize:13}}>
          No documents uploaded for this loan yet.
        </div>:<div style={{display:"flex",flexDirection:"column",gap:8}}>
          {myDocs.map(d=>(
            <div key={d.id} style={{background:"var(--white)",border:"1px solid var(--bd)",borderRadius:12,padding:"13px 16px",display:"flex",alignItems:"center",gap:14}}>
              <div style={{fontSize:26,flexShrink:0}}>📕</div>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:12,fontWeight:700,color:"var(--t1)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{d.name}</div>
                <div style={{fontSize:10,color:"var(--t3)",marginTop:2}}>Uploaded {d.uploadedAt} · {fSize(d.size)}</div>
              </div>
              <button onClick={()=>setTab("chat")} style={{padding:"5px 14px",background:"var(--bbg)",border:"1px solid var(--bbd)",borderRadius:8,fontSize:11,color:"var(--blue)",cursor:"pointer",fontWeight:600,whiteSpace:"nowrap"}}>Ask AI →</button>
              <button onClick={()=>deleteDoc(d.id)} style={{padding:"5px 10px",background:"var(--rbg)",border:"1px solid var(--rbd)",borderRadius:8,fontSize:11,color:"var(--red)",cursor:"pointer",fontWeight:600}}>✕</button>
            </div>
          ))}
        </div>}

        {myDocs.length>0&&<div style={{marginTop:16,padding:"12px 16px",background:"var(--bbg)",border:"1px solid var(--bbd)",borderRadius:12}}>
          <div style={{fontSize:11,fontWeight:700,color:"var(--blue)",marginBottom:4}}>✅ {myDocs.length} document{myDocs.length!==1?"s":""} ready for AI analysis</div>
          <div style={{fontSize:11,color:"var(--t3)"}}>Switch to the AI Chat tab to ask questions about these documents.</div>
          <button onClick={()=>setTab("chat")} style={{marginTop:8,padding:"6px 16px",background:"var(--t1)",border:"none",borderRadius:8,color:"#fff",fontSize:12,fontWeight:600,cursor:"pointer"}}>Open AI Chat →</button>
        </div>}
      </div>}

      {/* ── CHAT TAB ── */}
      {tab==="chat"&&<div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>

        {/* Messages */}
        <div style={{flex:1,overflowY:"auto",padding:"16px 20px",display:"flex",flexDirection:"column",gap:12}}>

          {myChat.length===0&&<>
            {/* Welcome state */}
            <div style={{background:"var(--white)",border:"1px solid var(--bd)",borderRadius:16,padding:"24px 28px",marginBottom:8}}>
              <div style={{fontSize:18,marginBottom:10}}>🤖</div>
              <div style={{fontSize:14,fontWeight:700,color:"var(--t1)",marginBottom:6}}>AI Loan Document Analyst</div>
              <div style={{fontSize:12,color:"var(--t3)",lineHeight:1.7}}>
                {myDocs.length===0
                  ?<>Upload loan documents on the <strong>Documents tab</strong> first. Once uploaded, I can extract key terms, flag risks, explain provisions, and answer any question about this loan's paperwork.</>
                  :<>I have access to <strong>{myDocs.length} document{myDocs.length!==1?"s":""}</strong> for <strong>{sel?.addr}</strong>. Ask me anything about this loan's terms, covenants, prepayment language, default provisions, or anything else in the paperwork.</>
                }
              </div>
              {myDocs.length===0&&<button onClick={()=>setTab("docs")} style={{marginTop:12,padding:"7px 18px",background:"var(--t1)",border:"none",borderRadius:9,color:"#fff",fontSize:12,fontWeight:600,cursor:"pointer"}}>Upload Documents →</button>}
            </div>

            {/* Suggested questions */}
            {myDocs.length>0&&<>
              <div style={{fontSize:10,fontWeight:700,color:"var(--t4)",textTransform:"uppercase",letterSpacing:".1em",marginBottom:4}}>Suggested Questions</div>
              <div style={{display:"flex",flexDirection:"column",gap:6}}>
                {SUGGESTED.map((q,i)=>(
                  <button key={i} onClick={()=>sendMessage(q)}
                    style={{textAlign:"left",padding:"10px 14px",background:"var(--white)",border:"1px solid var(--bd)",borderRadius:10,fontSize:12,color:"var(--t2)",cursor:"pointer",transition:"all .12s",display:"flex",alignItems:"center",gap:10}}
                    onMouseEnter={e=>{e.currentTarget.style.borderColor="var(--blue)";e.currentTarget.style.color="var(--blue)";}}
                    onMouseLeave={e=>{e.currentTarget.style.borderColor="var(--bd)";e.currentTarget.style.color="var(--t2)";}}>
                    <span style={{color:"var(--t4)",fontSize:11}}>↗</span>{q}
                  </button>
                ))}
              </div>
            </>}
          </>}

          {/* Chat messages */}
          {myChat.map((m,i)=>(
            <div key={i} style={{display:"flex",justifyContent:m.role==="user"?"flex-end":"flex-start",gap:10,alignItems:"flex-start"}}>
              {m.role==="assistant"&&<div style={{width:28,height:28,borderRadius:"50%",background:"linear-gradient(135deg,#3b82f6,#8b5cf6)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,flexShrink:0,marginTop:2}}>🤖</div>}
              <div style={{
                maxWidth:"80%",padding:"12px 16px",borderRadius:m.role==="user"?"14px 14px 4px 14px":"14px 14px 14px 4px",
                background:m.role==="user"?"var(--t1)":m.error?"var(--rbg)":"var(--white)",
                color:m.role==="user"?"#fff":m.error?"var(--red)":"var(--t1)",
                border:m.role==="user"?"none":m.error?"1px solid var(--rbd)":"1px solid var(--bd)",
                fontSize:13,lineHeight:1.7,whiteSpace:"pre-wrap",
              }}>{m.content}</div>
              {m.role==="user"&&<div style={{width:28,height:28,borderRadius:"50%",background:"var(--t1)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,color:"#fff",fontWeight:700,flexShrink:0,marginTop:2}}>M</div>}
            </div>
          ))}

          {/* Thinking indicator */}
          {thinking&&<div style={{display:"flex",alignItems:"flex-start",gap:10}}>
            <div style={{width:28,height:28,borderRadius:"50%",background:"linear-gradient(135deg,#3b82f6,#8b5cf6)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,flexShrink:0}}>🤖</div>
            <div style={{padding:"12px 18px",background:"var(--white)",border:"1px solid var(--bd)",borderRadius:"14px 14px 14px 4px",display:"flex",gap:5,alignItems:"center"}}>
              {[0,1,2].map(i=><div key={i} style={{width:7,height:7,borderRadius:"50%",background:"var(--t4)",animation:`pulse 1.4s ease-in-out ${i*0.2}s infinite`}}/>)}
            </div>
          </div>}

          <div ref={chatEndRef}/>
        </div>

        {/* Suggested chips (when chat has messages) */}
        {myChat.length>0&&myDocs.length>0&&!thinking&&<div style={{padding:"8px 20px 0",display:"flex",gap:6,flexWrap:"wrap",flexShrink:0}}>
          {SUGGESTED.slice(0,4).map((q,i)=>(
            <button key={i} onClick={()=>sendMessage(q)}
              style={{padding:"5px 12px",background:"var(--white)",border:"1px solid var(--bd)",borderRadius:20,fontSize:10,color:"var(--t3)",cursor:"pointer",whiteSpace:"nowrap",transition:"all .12s"}}
              onMouseEnter={e=>{e.currentTarget.style.borderColor="var(--blue)";e.currentTarget.style.color="var(--blue)";}}
              onMouseLeave={e=>{e.currentTarget.style.borderColor="var(--bd)";e.currentTarget.style.color="var(--t3)";}}>
              {q.slice(0,40)}{q.length>40?"…":""}
            </button>
          ))}
        </div>}

        {/* Input bar */}
        <div style={{padding:"12px 20px 16px",flexShrink:0,borderTop:"1px solid var(--bd)",background:"var(--white)"}}>
          {myDocs.length===0&&<div style={{fontSize:11,color:"var(--amber)",fontWeight:600,marginBottom:8,display:"flex",alignItems:"center",gap:6}}>
            ⚠️ No documents uploaded — <span style={{cursor:"pointer",textDecoration:"underline"}} onClick={()=>setTab("docs")}>upload PDFs first</span>
          </div>}
          <div style={{display:"flex",gap:8,alignItems:"flex-end"}}>
            <textarea
              value={input}
              onChange={e=>setInput(e.target.value)}
              onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();sendMessage();}}}
              placeholder={myDocs.length>0?"Ask anything about this loan's documents… (Enter to send, Shift+Enter for new line)":"Upload documents to start chatting…"}
              disabled={myDocs.length===0||thinking}
              rows={2}
              style={{flex:1,padding:"10px 14px",background:"var(--bg)",border:"1px solid var(--bd2)",borderRadius:12,fontSize:13,color:"var(--t1)",outline:"none",resize:"none",fontFamily:"inherit",lineHeight:1.5,opacity:myDocs.length===0?.5:1}}
            />
            <button onClick={()=>sendMessage()} disabled={!input.trim()||thinking||myDocs.length===0}
              style={{padding:"10px 18px",background:!input.trim()||thinking||myDocs.length===0?"var(--bd2)":"var(--t1)",border:"none",borderRadius:12,color:"#fff",fontSize:13,fontWeight:700,cursor:!input.trim()||thinking?"default":"pointer",transition:"all .15s",flexShrink:0,alignSelf:"stretch"}}>
              {thinking?"…":"↑"}
            </button>
          </div>
          <div style={{fontSize:9,color:"var(--t4)",marginTop:6,textAlign:"right"}}>Powered by Claude · Documents stay in your browser · Not sent to any third party except Anthropic API</div>
        </div>
      </div>}
    </div>

    <style>{`@keyframes pulse{0%,60%,100%{opacity:.25}30%{opacity:1}}`}</style>
  </div>);
}


/* ─────────── CONTACTS VIEW (standalone) ─────────── */
function ContactsView({loans,onSelect}){
  const [selId,setSelId]=useState(String(loans[0]?.id||""));
  const [contacts,setContacts]=useState({});
  const [loaded,setLoaded]=useState(false);
  const [showAdd,setShowAdd]=useState(false);
  const blank={role:"Servicer",name:"",company:"",phone:"",email:"",notes:""};
  const [nc,setNc]=useState(blank);

  useEffect(()=>{(async()=>{try{const r=await supaStorage.get("meridian-contacts");if(r?.value)setContacts(JSON.parse(r.value));}catch{}setLoaded(true);})();},[]);
  useEffect(()=>{if(!loaded)return;(async()=>{try{await supaStorage.set("meridian-contacts",JSON.stringify(contacts));}catch{}})();},[contacts,loaded]);

  const sel=loans.find(l=>String(l.id)===selId);
  const cur=contacts[selId]||[];
  const addC=()=>{if(!nc.name)return;setContacts(p=>({...p,[selId]:[...(p[selId]||[]),{...nc,id:Date.now()}]}));setNc(blank);setShowAdd(false);};
  const delC=id=>setContacts(p=>({...p,[selId]:(p[selId]||[]).filter(c=>c.id!==id)}));
  const roleIcon=r=>r==="Servicer"?"🏦":r==="Broker"?"🤝":r==="Attorney"?"⚖️":r==="Appraiser"?"🏠":r==="Insurance Agent"?"🛡️":"👤";
  const totalC=Object.values(contacts).reduce((s,a)=>s+a.length,0);

  if(loans.length===0)return(<div style={{padding:"64px 40px",textAlign:"center"}}><div style={{fontSize:32,opacity:.2,marginBottom:12}}>👤</div><div style={{fontSize:16,fontWeight:700,color:"var(--t3)"}}>Add loans first.</div></div>);

  return(<div>
    <div style={{marginBottom:20}}>
      <div style={{fontSize:22,fontWeight:700,color:"var(--t1)",marginBottom:4}}>Contacts</div>
      <div style={{fontSize:13,color:"var(--t3)"}}>{totalC} contact{totalC!==1?"s":""} stored · Servicers, brokers, attorneys, lenders — linked per property.</div>
    </div>
    <div style={{display:"grid",gridTemplateColumns:"240px 1fr",gap:16,alignItems:"start"}}>
      {/* Loan selector */}
      <div style={{background:"var(--white)",border:"1px solid var(--bd)",borderRadius:14,overflow:"hidden",position:"sticky",top:0}}>
        <div style={{padding:"11px 14px",borderBottom:"1px solid var(--bd)",fontSize:10,fontWeight:700,color:"var(--t3)",textTransform:"uppercase",letterSpacing:".07em"}}>Property</div>
        <div style={{maxHeight:520,overflowY:"auto"}}>
          {loans.map(l=>{const cnt=(contacts[String(l.id)]||[]).length;const isA=String(l.id)===selId;
            return(<div key={l.id} onClick={()=>setSelId(String(l.id))} style={{padding:"10px 14px",cursor:"pointer",borderLeft:`2px solid ${isA?"var(--blue)":"transparent"}`,background:isA?"var(--bbg)":"transparent",borderBottom:"1px solid var(--bd)",transition:"all .1s"}}>
              <div style={{fontSize:11,fontWeight:700,color:isA?"var(--blue)":"var(--t1)",marginBottom:2,lineHeight:1.3}}>{l.addr}</div>
              <div style={{fontSize:9,color:cnt>0?"var(--green)":"var(--t4)"}}>{cnt>0?`${cnt} contact${cnt!==1?"s":""}`:"No contacts"}</div>
            </div>);
          })}
        </div>
      </div>
      {/* Detail */}
      <div>
        {sel&&<>
          <div style={{background:"var(--white)",border:"1px solid var(--bd)",borderRadius:14,padding:"14px 18px",marginBottom:14,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div>
              <div style={{fontSize:15,fontWeight:800,color:"var(--t1)"}}>{sel.addr}</div>
              <div style={{fontSize:11,color:"var(--t3)"}}>{sel.lender} · {fPct(sel.rate)} · {cur.length} contact{cur.length!==1?"s":""}</div>
            </div>
            <button className="btn-dark" onClick={()=>setShowAdd(s=>!s)}>+ Add Contact</button>
          </div>
          {showAdd&&<div style={{background:"var(--white)",border:"1px solid var(--bd)",borderRadius:14,padding:"18px 20px",marginBottom:14,boxShadow:"0 4px 16px rgba(0,0,0,.07)"}}>
            <div style={{fontSize:13,fontWeight:700,color:"var(--t1)",marginBottom:12}}>New Contact</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
              <div><div className="flbl" style={{display:"block",marginBottom:3}}>Name *</div><input className="finp" value={nc.name} onChange={e=>setNc(p=>({...p,name:e.target.value}))} placeholder="Jane Smith"/></div>
              <div><div className="flbl" style={{display:"block",marginBottom:3}}>Role</div><select className="finp" value={nc.role} onChange={e=>setNc(p=>({...p,role:e.target.value}))}>{CONTACT_ROLES.map(r=><option key={r}>{r}</option>)}</select></div>
              <div><div className="flbl" style={{display:"block",marginBottom:3}}>Company</div><input className="finp" value={nc.company} onChange={e=>setNc(p=>({...p,company:e.target.value}))} placeholder="Meridian Capital"/></div>
              <div><div className="flbl" style={{display:"block",marginBottom:3}}>Phone</div><input className="finp" value={nc.phone} onChange={e=>setNc(p=>({...p,phone:e.target.value}))} placeholder="+1 212 555 0100"/></div>
              <div><div className="flbl" style={{display:"block",marginBottom:3}}>Email</div><input className="finp" value={nc.email} onChange={e=>setNc(p=>({...p,email:e.target.value}))} placeholder="jane@firm.com"/></div>
              <div><div className="flbl" style={{display:"block",marginBottom:3}}>Notes</div><input className="finp" value={nc.notes} onChange={e=>setNc(p=>({...p,notes:e.target.value}))} placeholder="Preferred contact for extensions"/></div>
            </div>
            <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}><button className="btn-light" onClick={()=>{setShowAdd(false);setNc(blank);}}>Cancel</button><button className="btn-dark" onClick={addC}>Save</button></div>
          </div>}
          {cur.length===0&&!showAdd?<div style={{background:"var(--white)",border:"2px dashed var(--bd2)",borderRadius:14,padding:"48px 24px",textAlign:"center"}}>
            <div style={{fontSize:28,opacity:.15,marginBottom:8}}>👤</div>
            <div style={{fontSize:13,fontWeight:600,color:"var(--t3)",marginBottom:4}}>No contacts for this property</div>
            <div style={{fontSize:11,color:"var(--t4)"}}>Add servicers, brokers, attorneys, and key contacts.</div>
          </div>:<div style={{display:"flex",flexDirection:"column",gap:8}}>
            {cur.map(c=>(
              <div key={c.id} style={{background:"var(--white)",border:"1px solid var(--bd)",borderRadius:12,padding:"14px 18px",display:"flex",gap:14,alignItems:"flex-start"}}>
                <div style={{width:38,height:38,borderRadius:"50%",background:"var(--bg)",border:"1px solid var(--bd)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,flexShrink:0}}>{roleIcon(c.role)}</div>
                <div style={{flex:1}}>
                  <div style={{fontSize:13,fontWeight:700,color:"var(--t1)",marginBottom:2}}>{c.name}</div>
                  {c.company&&<div style={{fontSize:11,color:"var(--t3)",marginBottom:4}}>{c.company}</div>}
                  <span style={{fontSize:9,fontWeight:700,padding:"2px 8px",borderRadius:20,background:"var(--bbg)",color:"var(--blue)",border:"1px solid var(--bbd)"}}>{c.role}</span>
                  <div style={{marginTop:8,display:"flex",flexDirection:"column",gap:4}}>
                    {c.phone&&<div style={{display:"flex",alignItems:"center",gap:6}}><span style={{fontSize:11,color:"var(--t4)"}}>📞</span><a href={`tel:${c.phone}`} style={{fontSize:11,color:"var(--blue)",textDecoration:"none"}}>{c.phone}</a><CopyBtn text={c.phone}/></div>}
                    {c.email&&<div style={{display:"flex",alignItems:"center",gap:6}}><span style={{fontSize:11,color:"var(--t4)"}}>✉️</span><a href={`mailto:${c.email}`} style={{fontSize:11,color:"var(--blue)",textDecoration:"none",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:280}}>{c.email}</a><CopyBtn text={c.email}/></div>}
                  </div>
                  {c.notes&&<div style={{marginTop:8,fontSize:10,color:"var(--t3)",lineHeight:1.5,borderTop:"1px solid var(--bd)",paddingTop:8}}>{c.notes}</div>}
                </div>
                <button onClick={()=>delC(c.id)} style={{background:"none",border:"none",cursor:"pointer",fontSize:12,color:"var(--t4)",padding:"2px 6px"}}>✕</button>
              </div>
            ))}
          </div>}
        </>}
      </div>
    </div>
  </div>);
}

/* ─────────── IMG SLOT (lazy signed-URL loader) ─────────── */
function ImgSlot({f, getUrl, onLightbox}){
  const [src,setSrc]=useState(f.data||null); // use base64 immediately if available
  useEffect(()=>{
    if(!src&&f.storagePath){
      getUrl(f.storagePath,f.id).then(url=>{if(url)setSrc(url);});
    }
  },[f.storagePath,f.id]);
  if(!src)return(<div style={{width:"100%",paddingTop:"56%",position:"relative",borderRadius:6,background:"var(--bg)",display:"flex",alignItems:"center",justifyContent:"center"}}>
    <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,color:"var(--t4)"}}>Loading…</div>
  </div>);
  return(<div onClick={()=>onLightbox({src,name:f.name})} style={{width:"100%",paddingTop:"56%",position:"relative",borderRadius:6,overflow:"hidden",cursor:"pointer",background:"var(--bg)"}}>
    <img src={src} alt={f.name} style={{position:"absolute",inset:0,width:"100%",height:"100%",objectFit:"cover"}}/>
  </div>);
}

/* ─────────── DOCUMENTS VIEW (full building grid + slots) ─────────── */
const DOC_SLOTS=[
  {id:"loan_agreement",label:"Loan Agreement",icon:"📋",required:true},
  {id:"promissory_note",label:"Promissory Note",icon:"✍️",required:true},
  {id:"appraisal",label:"Appraisal",icon:"🏠",required:true},
  {id:"title_policy",label:"Title Policy",icon:"🔏",required:true},
  {id:"survey",label:"Survey",icon:"📐",required:false},
  {id:"environmental",label:"Environmental",icon:"🌿",required:false},
  {id:"insurance",label:"Insurance",icon:"🛡️",required:false},
  {id:"tax_records",label:"Tax Records",icon:"📊",required:false},
  {id:"photos",label:"Property Photos",icon:"📷",required:false},
  {id:"other",label:"Other",icon:"📎",required:false},
];

function DocumentsView({loans}){
  const [docs,setDocs]=useState({});  // {loanId:{slotId:[{id,name,size,type,data,uploadedAt}]}}
  const [loaded,setLoaded]=useState(false);
  const [uploadingSlot,setUploadingSlot]=useState(null); // "loanId-slotId"
  const [expandedLoan,setExpandedLoan]=useState(null);
  const [lightbox,setLightbox]=useState(null); // {src,name}
  const [searchQ,setSearchQ]=useState("");
  const [filterMissing,setFilterMissing]=useState(false);
  const fileRefs=React.useRef({});

  // docs state: {loanId: {slotId: [{id, name, size, type, storagePath, uploadedAt}]}}
  // Files live in Supabase Storage; metadata lives in user_storage table
  useEffect(()=>{(async()=>{
    try{const r=await supaStorage.get("meridian-propdocs");if(r?.value)setDocs(JSON.parse(r.value));}catch{}
    setLoaded(true);
  })();},[]);
  useEffect(()=>{if(!loaded)return;(async()=>{
    // Save metadata only (no base64 blobs)
    try{await supaStorage.set("meridian-propdocs",JSON.stringify(docs));}catch{}
  })();},[docs,loaded]);

  // Signed URL cache so we don't re-fetch on every render
  const [urlCache,setUrlCache]=useState({});
  const getUrl=useCallback(async(storagePath,fileId)=>{
    if(urlCache[fileId])return urlCache[fileId];
    if(!storagePath)return null;
    const url=await supaStorage.getFileURL(storagePath);
    if(url)setUrlCache(p=>({...p,[fileId]:url}));
    return url;
  },[urlCache]);

  const uploadFile=async(loanId,slotId,file)=>{
    if(file.size>10*1024*1024){alert("File must be under 10MB.");return;}
    const key=`${loanId}-${slotId}`;
    setUploadingSlot(key);
    try{
      const fileId=Date.now();
      const ext=file.name.split(".").pop();
      const storagePath=`docs/${loanId}/${slotId}/${fileId}.${ext}`;
      // Upload to Supabase Storage
      const uploadedPath=await supaStorage.uploadFile(storagePath,file,file.type);
      // Fall back to base64 if Supabase not configured (local mode)
      let fallbackData=null;
      if(!uploadedPath){
        fallbackData=await new Promise((res,rej)=>{const r=new FileReader();r.onload=e=>res(e.target.result);r.onerror=rej;r.readAsDataURL(file);});
      }
      const entry={id:fileId,name:file.name,size:file.size,type:file.type,storagePath:uploadedPath||null,data:fallbackData,uploadedAt:TODAY_STR};
      setDocs(p=>{
        const lDocs={...(p[loanId]||{})};
        lDocs[slotId]=[...(lDocs[slotId]||[]),entry];
        return{...p,[loanId]:lDocs};
      });
    }catch(e){alert(`Upload failed: ${e.message}`);}
    setUploadingSlot(null);
  };

  const deleteFile=async(loanId,slotId,fileId)=>{
    // Find storagePath and remove from Supabase Storage
    const f=(docs[loanId]?.[slotId]||[]).find(x=>x.id===fileId);
    if(f?.storagePath)await supaStorage.deleteFile(f.storagePath);
    setDocs(p=>{
      const lDocs={...(p[loanId]||{})};
      lDocs[slotId]=(lDocs[slotId]||[]).filter(f=>f.id!==fileId);
      return{...p,[loanId]:lDocs};
    });
  };

  const downloadFile=async f=>{
    let url=f.data; // local fallback
    if(f.storagePath){url=await supaStorage.getFileURL(f.storagePath)||f.data;}
    if(!url)return;
    const a=document.createElement("a");a.href=url;a.download=f.name;a.target="_blank";a.click();
  };
  const fmtSize=b=>b>1e6?`${(b/1e6).toFixed(1)}MB`:b>1e3?`${(b/1024).toFixed(0)}KB`:`${b}B`;
  const isImg=t=>t&&t.startsWith("image/");

  const totalFiles=Object.values(docs).reduce((s,ld)=>s+Object.values(ld).reduce((s2,arr)=>s2+arr.length,0),0);
  const loansWithAllRequired=loans.filter(l=>{
    const ld=docs[l.id]||{};
    return DOC_SLOTS.filter(s=>s.required).every(s=>(ld[s.id]||[]).length>0);
  }).length;
  const loansMissingRequired=loans.filter(l=>{
    const ld=docs[l.id]||{};
    return DOC_SLOTS.filter(s=>s.required).some(s=>!(ld[s.id]||[]).length);
  }).length;

  const filteredLoans=loans.filter(l=>{
    if(searchQ&&!l.addr.toLowerCase().includes(searchQ.toLowerCase()))return false;
    if(filterMissing){const ld=docs[l.id]||{};return DOC_SLOTS.filter(s=>s.required).some(s=>!(ld[s.id]||[]).length);}
    return true;
  });

  return(<div>
    {/* Header */}
    <div style={{marginBottom:20}}>
      <div style={{fontSize:22,fontWeight:700,color:"var(--t1)",marginBottom:4}}>Property Documents</div>
      <div style={{fontSize:13,color:"var(--t3)"}}>Every building · Every required document · Upload once, access anywhere.</div>
    </div>

    {/* KPIs */}
    <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:20}}>
      {[
        {l:"Total Files",v:totalFiles,c:"var(--blue)",bg:"var(--bbg)",bd:"var(--bbd)"},
        {l:"Fully Documented",v:loansWithAllRequired,c:"var(--green)",bg:"var(--gbg)",bd:"var(--gbd)"},
        {l:"Missing Required Docs",v:loansMissingRequired,c:loansMissingRequired>0?"var(--red)":"var(--green)",bg:loansMissingRequired>0?"var(--rbg)":"var(--gbg)",bd:loansMissingRequired>0?"var(--rbd)":"var(--gbd)"},
        {l:"Total Buildings",v:loans.length,c:"var(--t1)",bg:"var(--white)",bd:"var(--bd)"},
      ].map((k,i)=><div key={i} style={{background:k.bg,border:`1px solid ${k.bd}`,borderRadius:12,padding:"14px 16px"}}>
        <div style={{fontSize:9,fontWeight:800,color:k.c,textTransform:"uppercase",letterSpacing:".07em",marginBottom:6}}>{k.l}</div>
        <div style={{fontSize:26,fontWeight:800,color:k.c,lineHeight:1}}>{k.v}</div>
      </div>)}
    </div>

    {/* Search + filter */}
    <div style={{display:"flex",gap:8,marginBottom:16,alignItems:"center"}}>
      <input value={searchQ} onChange={e=>setSearchQ(e.target.value)} placeholder="Search building address…" style={{flex:1,maxWidth:300,padding:"7px 12px",border:"1px solid var(--bd)",borderRadius:9,fontSize:12,color:"var(--t1)",outline:"none",background:"var(--white)"}}/>
      <button onClick={()=>setFilterMissing(s=>!s)} style={{padding:"7px 14px",borderRadius:9,border:`1px solid ${filterMissing?"var(--red)":"var(--bd)"}`,background:filterMissing?"var(--rbg)":"var(--white)",color:filterMissing?"var(--red)":"var(--t3)",fontSize:11,fontWeight:filterMissing?700:400,cursor:"pointer"}}>
        {filterMissing?"Showing: Missing Docs":"Filter: Missing Required"}
      </button>
      <span style={{fontSize:11,color:"var(--t4)"}}>{filteredLoans.length} building{filteredLoans.length!==1?"s":""}</span>
    </div>

    {/* Building grid */}
    <div style={{display:"flex",flexDirection:"column",gap:8}}>
      {filteredLoans.map(l=>{
        const ld=docs[l.id]||{};
        const reqSlots=DOC_SLOTS.filter(s=>s.required);
        const filledReq=reqSlots.filter(s=>(ld[s.id]||[]).length>0).length;
        const allFilled=filledReq===reqSlots.length;
        const totalFilesForLoan=Object.values(ld).reduce((s,a)=>s+a.length,0);
        const isExpanded=expandedLoan===l.id;
        const el=enrich(l);

        return(<div key={l.id} style={{background:"var(--white)",border:`1px solid ${allFilled?"var(--gbd)":"var(--bd)"}`,borderRadius:14,overflow:"hidden",transition:"box-shadow .15s"}}>
          {/* Building header row */}
          <div onClick={()=>setExpandedLoan(isExpanded?null:l.id)} style={{padding:"14px 20px",cursor:"pointer",display:"flex",alignItems:"center",gap:16,userSelect:"none"}}>
            {/* Doc coverage mini-bar */}
            <div style={{width:48,height:48,borderRadius:12,background:allFilled?"var(--gbg)":"var(--rbg)",border:`1px solid ${allFilled?"var(--gbd)":"var(--rbd)"}`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
              <div style={{textAlign:"center"}}>
                <div style={{fontSize:14,fontWeight:800,color:allFilled?"var(--green)":"var(--red)"}}>{filledReq}</div>
                <div style={{fontSize:8,color:allFilled?"var(--green)":"var(--red)",lineHeight:1}}>/{reqSlots.length}</div>
              </div>
            </div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:13,fontWeight:700,color:"var(--t1)",marginBottom:2}}>{l.addr}</div>
              <div style={{fontSize:10,color:"var(--t3)"}}>{l.lender} · {fPct(l.rate)} · Matures {fDateS(l.maturityDate)}</div>
              {/* Slot progress dots */}
              <div style={{display:"flex",gap:3,marginTop:6,flexWrap:"wrap"}}>
                {DOC_SLOTS.map(s=>{
                  const filled=(ld[s.id]||[]).length>0;
                  return(<div key={s.id} title={`${s.label}: ${filled?"uploaded":"missing"}`} style={{width:8,height:8,borderRadius:"50%",background:filled?"var(--green)":s.required?"var(--red)":"var(--bd2)",flexShrink:0}}/>);
                })}
                {totalFilesForLoan>0&&<span style={{fontSize:9,color:"var(--t4)",marginLeft:4}}>{totalFilesForLoan} file{totalFilesForLoan!==1?"s":""}</span>}
              </div>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:10,flexShrink:0}}>
              {allFilled&&<span style={{fontSize:9,fontWeight:800,padding:"3px 10px",borderRadius:20,background:"var(--gbg)",color:"var(--green)",border:"1px solid var(--gbd)"}}>✓ COMPLETE</span>}
              {!allFilled&&loansMissingRequired>0&&<span style={{fontSize:9,fontWeight:700,color:"var(--red)"}}>{reqSlots.length-filledReq} req. missing</span>}
              <span style={{fontSize:13,color:"var(--t4)",transform:isExpanded?"rotate(90deg)":"",transition:"transform .2s",display:"inline-block"}}>▶</span>
            </div>
          </div>

          {/* Expanded slot grid */}
          {isExpanded&&<div style={{borderTop:"1px solid var(--bd)",padding:"16px 20px",background:"var(--bg)"}}>
            <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:10}}>
              {DOC_SLOTS.map(slot=>{
                const files=ld[slot.id]||[];
                const slotKey=`${l.id}-${slot.id}`;
                const isUploading=uploadingSlot===slotKey;
                return(<div key={slot.id} style={{background:"var(--white)",border:`1px solid ${files.length>0?"var(--gbd)":slot.required?"var(--rbd)":"var(--bd)"}`,borderRadius:12,overflow:"hidden"}}>
                  {/* Slot header */}
                  <div style={{padding:"8px 10px",borderBottom:"1px solid var(--bd)",background:files.length>0?"var(--gbg)":slot.required?"var(--rbg)":"var(--bg)",display:"flex",alignItems:"center",gap:6}}>
                    <span style={{fontSize:14}}>{slot.icon}</span>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:9,fontWeight:700,color:files.length>0?"var(--green)":slot.required?"var(--red)":"var(--t3)",lineHeight:1.2}}>{slot.label}</div>
                      {slot.required&&<div style={{fontSize:8,color:"var(--t4)"}}>required</div>}
                    </div>
                    {files.length>0&&<span style={{fontSize:9,fontWeight:800,color:"var(--green)"}}>✓</span>}
                  </div>

                  {/* Files */}
                  <div style={{padding:"8px 10px",minHeight:60}}>
                    {files.length===0&&<div style={{fontSize:9,color:"var(--t4)",textAlign:"center",padding:"8px 0",opacity:.7}}>No files</div>}
                    {files.map(f=>(
                      <div key={f.id} style={{marginBottom:5}}>
                        {isImg(f.type)
                          ? <ImgSlot f={f} getUrl={getUrl} onLightbox={setLightbox}/>
                          : <div style={{display:"flex",alignItems:"center",gap:5,padding:"4px 6px",background:"var(--bg)",borderRadius:6}}>
                              <span style={{fontSize:12}}>📄</span>
                              <div style={{flex:1,minWidth:0}}>
                                <div style={{fontSize:9,fontWeight:600,color:"var(--t1)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{f.name}</div>
                                <div style={{fontSize:8,color:"var(--t4)"}}>{fmtSize(f.size)}</div>
                              </div>
                            </div>
                        }
                        <div style={{display:"flex",gap:3,marginTop:3}}>
                          <button onClick={()=>downloadFile(f)} style={{flex:1,padding:"2px 0",background:"var(--bbg)",border:"1px solid var(--bbd)",borderRadius:5,fontSize:8,color:"var(--blue)",cursor:"pointer",fontWeight:600}}>⬇</button>
                          <button onClick={()=>deleteFile(l.id,slot.id,f.id)} style={{flex:1,padding:"2px 0",background:"var(--rbg)",border:"1px solid var(--rbd)",borderRadius:5,fontSize:8,color:"var(--red)",cursor:"pointer"}}>✕</button>
                        </div>
                      </div>
                    ))}

                    {/* Upload button */}
                    <label style={{display:"block",marginTop:4,padding:"5px",background:isUploading?"var(--bg)":"transparent",border:`1px dashed ${isUploading?"var(--t4)":"var(--bd2)"}`,borderRadius:7,textAlign:"center",cursor:isUploading?"default":"pointer",transition:"border-color .15s"}}
                      onMouseEnter={e=>{if(!isUploading)e.currentTarget.style.borderColor="var(--blue)";}}
                      onMouseLeave={e=>{e.currentTarget.style.borderColor="var(--bd2)";}}>
                      <input type="file" style={{display:"none"}} accept="image/*,.pdf,.doc,.docx,.xls,.xlsx" disabled={isUploading}
                        onChange={e=>{const f=e.target.files?.[0];if(f)uploadFile(l.id,slot.id,f);e.target.value="";}}/>
                      <span style={{fontSize:9,color:"var(--t4)"}}>{isUploading?"⏳…":"＋ Upload"}</span>
                    </label>
                  </div>
                </div>);
              })}
            </div>
          </div>}
        </div>);
      })}
    </div>

    {/* Lightbox */}
    {lightbox&&<div onClick={()=>setLightbox(null)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,.85)",zIndex:2000,display:"flex",alignItems:"center",justifyContent:"center",padding:24,cursor:"pointer"}}>
      <div style={{maxWidth:"90vw",maxHeight:"85vh",display:"flex",flexDirection:"column",gap:8}}>
        <img src={lightbox.src} alt={lightbox.name} style={{maxWidth:"100%",maxHeight:"78vh",borderRadius:12,objectFit:"contain"}}/>
        <div style={{textAlign:"center",fontSize:12,color:"rgba(255,255,255,.6)"}}>{lightbox.name} — click anywhere to close</div>
      </div>
    </div>}
  </div>);
}

/* ─────────── STATEMENT ANALYZER ─────────── */
function StatementAnalyzer({loans}){
  const [file,setFile]=useState(null);
  const [fileData,setFileData]=useState(null);
  const [fileType,setFileType]=useState(null);
  const [analyzing,setAnalyzing]=useState(false);
  const [result,setResult]=useState(null);
  const [selLoan,setSelLoan]=useState(String(loans[0]?.id||""));
  const [dragOver,setDragOver]=useState(false);
  const fileRef=React.useRef(null);

  const handleFile=async f=>{
    if(!f)return;
    const allowed=["application/pdf","image/jpeg","image/png","image/jpg"];
    if(!allowed.includes(f.type)&&!f.name.endsWith(".pdf")){alert("Upload a PDF or image of your financial statement.");return;}
    if(f.size>4.5*1024*1024){alert("File must be under 4.5MB.");return;}
    setFile(f);setResult(null);
    const b64=await new Promise((res,rej)=>{const r=new FileReader();r.onload=e=>res(e.target.result.split(",")[1]);r.onerror=rej;r.readAsDataURL(f);});
    setFileData(b64);setFileType(f.type.includes("pdf")?"application/pdf":f.type);
  };

  const analyze=async()=>{
    if(!fileData)return;
    setAnalyzing(true);setResult(null);
    const loan=loans.find(l=>String(l.id)===selLoan);
    const el=loan?enrich(loan):null;

    const systemPrompt=`You are a senior CRE mortgage analyst specializing in refinancing risk assessment for Brooklyn multifamily portfolios. Analyze the uploaded financial statement and provide a structured refi risk report.

${loan?`Loan context for ${loan.addr}:
- Lender: ${loan.lender} | Type: ${loan.loanType} | Rate: ${fPct(loan.rate)}
- Current balance: ${f$(el?.curBal)} | Original: ${f$(loan.origBalance)}
- Maturity: ${loan.maturityDate} (${el?.daysLeft>0?el?.daysLeft+" days":Math.abs(el?.daysLeft||0)+" days overdue"})
- DSCR Covenant: ${loan.dscrCovenant||"N/A"} | Current NOI: ${loan.annualNOI?f$(loan.annualNOI):"Not on file"}
- Prepay: ${loan.prepay||"None"}`:""} 

Return a JSON object with exactly this structure:
{
  "refiRiskScore": 1-10 (1=easy refi, 10=near impossible),
  "riskRating": "Low"|"Moderate"|"High"|"Critical",
  "incomeAnalysis": {
    "effectiveGrossIncome": "$X",
    "operatingExpenses": "$X",
    "noi": "$X",
    "noiTrend": "Increasing"|"Stable"|"Declining"|"Cannot determine",
    "vacancyRate": "X%" or "Not stated",
    "notes": "brief analysis"
  },
  "debtServiceCoverage": {
    "currentDSCR": "X.XXx" or "Cannot calculate",
    "requiredDSCR": "typically 1.20-1.25x for most lenders",
    "meetsThreshold": true|false|null,
    "notes": "brief notes"
  },
  "keyRisks": ["risk 1","risk 2","risk 3"],
  "refiReadiness": {
    "incomeStrength": "Strong"|"Adequate"|"Weak"|"Unknown",
    "documentationQuality": "Complete"|"Partial"|"Insufficient",
    "estimatedLTV": "X%" or "Cannot calculate",
    "maxPotentialLoan": "$X" or "Cannot calculate"
  },
  "recommendations": ["action 1","action 2","action 3"],
  "redFlags": ["flag 1"] or [],
  "positives": ["positive 1"] or [],
  "summary": "2-3 sentence executive summary of refi prospects"
}

Respond with ONLY the JSON object. No markdown, no explanation.`;

    try{
      const contentBlocks=[
        {type:fileType==="application/pdf"?"document":"image",source:{type:"base64",media_type:fileType,data:fileData}},
        {type:"text",text:"Analyze this financial statement and return the JSON refi risk assessment."}
      ];
      const resp=await fetch("https://api.anthropic.com/v1/messages",{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:1000,system:systemPrompt,messages:[{role:"user",content:contentBlocks}]})
      });
      const data=await resp.json();
      const raw=data.content?.filter(b=>b.type==="text").map(b=>b.text).join("")||"{}";
      const clean=raw.replace(/```json|```/g,"").trim();
      setResult(JSON.parse(clean));
    }catch(e){setResult({error:true,message:`Analysis failed: ${e.message}. Please try again.`});}
    setAnalyzing(false);
  };

  const riskColor=r=>r==="Low"?"var(--green)":r==="Moderate"?"var(--amber)":r==="High"?"var(--red)":"var(--red)";
  const riskBg=r=>r==="Low"?"var(--gbg)":r==="Moderate"?"#fffbeb":r==="High"?"var(--rbg)":"var(--rbg)";

  return(<div>
    <div style={{marginBottom:20}}>
      <div style={{fontSize:22,fontWeight:700,color:"var(--t1)",marginBottom:4}}>Statement Analyzer</div>
      <div style={{fontSize:13,color:"var(--t3)"}}>Upload a rent roll, operating statement, or profit & loss — AI grades your refi readiness and surfaces risks.</div>
    </div>

    <div style={{display:"grid",gridTemplateColumns:"340px 1fr",gap:16,alignItems:"start"}}>
      {/* Left: upload panel */}
      <div style={{display:"flex",flexDirection:"column",gap:12}}>
        {/* Loan selector */}
        {loans.length>0&&<div style={{background:"var(--white)",border:"1px solid var(--bd)",borderRadius:14,padding:"14px 16px"}}>
          <div style={{fontSize:10,fontWeight:700,color:"var(--t3)",textTransform:"uppercase",letterSpacing:".07em",marginBottom:8}}>Link to Loan (Optional)</div>
          <select value={selLoan} onChange={e=>setSelLoan(e.target.value)} className="finp" style={{width:"100%"}}>
            <option value="">No loan selected</option>
            {loans.map(l=><option key={l.id} value={String(l.id)}>{l.addr} — {l.lender}</option>)}
          </select>
        </div>}

        {/* Drop zone */}
        <div
          onDragOver={e=>{e.preventDefault();setDragOver(true);}}
          onDragLeave={()=>setDragOver(false)}
          onDrop={e=>{e.preventDefault();setDragOver(false);handleFile(e.dataTransfer.files[0]);}}
          onClick={()=>fileRef.current?.click()}
          style={{border:`2px dashed ${dragOver?"var(--blue)":file?"var(--green)":"var(--bd2)"}`,borderRadius:14,padding:"28px 20px",textAlign:"center",cursor:"pointer",background:dragOver?"var(--bbg)":file?"var(--gbg)":"var(--white)",transition:"all .15s"}}>
          <input ref={fileRef} type="file" accept=".pdf,image/*" style={{display:"none"}} onChange={e=>handleFile(e.target.files?.[0])}/>
          <div style={{fontSize:28,marginBottom:8,opacity:.5}}>{file?"✅":"📤"}</div>
          <div style={{fontSize:13,fontWeight:700,color:"var(--t1)",marginBottom:4}}>
            {file?file.name:"Drop statement here"}
          </div>
          <div style={{fontSize:11,color:"var(--t3)"}}>
            {file?`${(file.size/1024).toFixed(0)}KB · Click to change`:"PDF or image · Rent roll, P&L, operating statement · up to 4.5MB"}
          </div>
        </div>

        {file&&<button onClick={analyze} disabled={analyzing} style={{width:"100%",padding:"12px",background:analyzing?"var(--bd2)":"var(--t1)",border:"none",borderRadius:12,color:"#fff",fontSize:13,fontWeight:800,cursor:analyzing?"default":"pointer",transition:"all .15s",letterSpacing:".02em"}}>
          {analyzing?"🧠 Analyzing…":"Analyze Refi Risk →"}
        </button>}

        {analyzing&&<div style={{background:"var(--white)",border:"1px solid var(--bd)",borderRadius:12,padding:"14px 16px",textAlign:"center"}}>
          <div style={{fontSize:11,color:"var(--t3)",marginBottom:6}}>Reading document…</div>
          <div style={{display:"flex",gap:4,justifyContent:"center"}}>
            {[0,1,2,3].map(i=><div key={i} style={{width:8,height:8,borderRadius:"50%",background:"var(--blue)",animation:`pulse 1.4s ease-in-out ${i*0.15}s infinite`}}/>)}
          </div>
        </div>}

        {/* Tips */}
        <div style={{background:"var(--bbg)",border:"1px solid var(--bbd)",borderRadius:12,padding:"13px 16px"}}>
          <div style={{fontSize:10,fontWeight:700,color:"var(--blue)",marginBottom:6}}>💡 Best documents to upload</div>
          {["Current year rent roll with occupancy","Last 2 years operating statements","T12 income & expense statement","Year-to-date P&L with actuals"].map((t,i)=>(
            <div key={i} style={{fontSize:10,color:"var(--t3)",marginBottom:3,display:"flex",gap:6}}><span style={{color:"var(--blue)"}}>→</span>{t}</div>
          ))}
        </div>
      </div>

      {/* Right: results */}
      <div>
        {!result&&!analyzing&&<div style={{background:"var(--white)",border:"2px dashed var(--bd2)",borderRadius:16,padding:"64px 32px",textAlign:"center"}}>
          <div style={{fontSize:40,opacity:.15,marginBottom:12}}>📊</div>
          <div style={{fontSize:15,fontWeight:700,color:"var(--t3)",marginBottom:6}}>Upload a statement to begin analysis</div>
          <div style={{fontSize:12,color:"var(--t4)"}}>AI will extract income, expenses, DSCR, and grade your refinancing readiness.</div>
        </div>}

        {result&&result.error&&<div style={{background:"var(--rbg)",border:"1px solid var(--rbd)",borderRadius:14,padding:"24px"}}>
          <div style={{fontSize:14,fontWeight:700,color:"var(--red)",marginBottom:6}}>Analysis Error</div>
          <div style={{fontSize:12,color:"var(--t2)"}}>{result.message}</div>
        </div>}

        {result&&!result.error&&<div style={{display:"flex",flexDirection:"column",gap:12}}>
          {/* Risk score hero */}
          <div style={{background:riskBg(result.riskRating),border:`1px solid ${riskColor(result.riskRating)}30`,borderRadius:16,padding:"20px 24px",display:"flex",alignItems:"center",gap:24}}>
            <div style={{textAlign:"center",flexShrink:0}}>
              <div style={{fontSize:48,fontWeight:900,color:riskColor(result.riskRating),lineHeight:1}}>{result.refiRiskScore}</div>
              <div style={{fontSize:9,fontWeight:700,color:riskColor(result.riskRating),textTransform:"uppercase",letterSpacing:".1em",marginTop:2}}>Risk Score /10</div>
            </div>
            <div style={{flex:1}}>
              <div style={{fontSize:20,fontWeight:800,color:riskColor(result.riskRating),marginBottom:6}}>{result.riskRating} Risk</div>
              <div style={{fontSize:12,color:"var(--t2)",lineHeight:1.7}}>{result.summary}</div>
            </div>
          </div>

          {/* Income + DSCR */}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
            <div style={{background:"var(--white)",border:"1px solid var(--bd)",borderRadius:14,padding:"16px 18px"}}>
              <div style={{fontSize:10,fontWeight:800,color:"var(--t3)",textTransform:"uppercase",letterSpacing:".08em",marginBottom:12}}>Income Analysis</div>
              {[
                {l:"Eff. Gross Income",v:result.incomeAnalysis?.effectiveGrossIncome},
                {l:"Operating Expenses",v:result.incomeAnalysis?.operatingExpenses},
                {l:"Net Operating Income",v:result.incomeAnalysis?.noi,bold:true},
                {l:"Vacancy Rate",v:result.incomeAnalysis?.vacancyRate},
                {l:"NOI Trend",v:result.incomeAnalysis?.noiTrend},
              ].map((r,i)=><div key={i} style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:"1px solid var(--bd)",fontSize:11}}>
                <span style={{color:"var(--t3)"}}>{r.l}</span>
                <span style={{fontWeight:r.bold?800:600,color:"var(--t1)"}}>{r.v||"—"}</span>
              </div>)}
              {result.incomeAnalysis?.notes&&<div style={{fontSize:10,color:"var(--t4)",marginTop:8,lineHeight:1.5}}>{result.incomeAnalysis.notes}</div>}
            </div>
            <div style={{background:"var(--white)",border:"1px solid var(--bd)",borderRadius:14,padding:"16px 18px"}}>
              <div style={{fontSize:10,fontWeight:800,color:"var(--t3)",textTransform:"uppercase",letterSpacing:".08em",marginBottom:12}}>Debt Service Coverage</div>
              {[
                {l:"Calculated DSCR",v:result.debtServiceCoverage?.currentDSCR,bold:true},
                {l:"Lender Minimum",v:result.debtServiceCoverage?.requiredDSCR},
                {l:"Meets Threshold",v:result.debtServiceCoverage?.meetsThreshold===true?"✅ Yes":result.debtServiceCoverage?.meetsThreshold===false?"❌ No":"Unknown"},
              ].map((r,i)=><div key={i} style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:"1px solid var(--bd)",fontSize:11}}>
                <span style={{color:"var(--t3)"}}>{r.l}</span>
                <span style={{fontWeight:r.bold?800:600,color:"var(--t1)"}}>{r.v||"—"}</span>
              </div>)}
              <div style={{fontSize:10,fontWeight:800,color:"var(--t3)",textTransform:"uppercase",letterSpacing:".08em",marginBottom:8,marginTop:12}}>Refi Readiness</div>
              {[
                {l:"Income Strength",v:result.refiReadiness?.incomeStrength},
                {l:"Documentation",v:result.refiReadiness?.documentationQuality},
                {l:"Est. LTV",v:result.refiReadiness?.estimatedLTV},
                {l:"Max Loan",v:result.refiReadiness?.maxPotentialLoan},
              ].map((r,i)=><div key={i} style={{display:"flex",justifyContent:"space-between",padding:"5px 0",borderBottom:"1px solid var(--bd)",fontSize:11}}>
                <span style={{color:"var(--t3)"}}>{r.l}</span>
                <span style={{fontWeight:600,color:"var(--t1)"}}>{r.v||"—"}</span>
              </div>)}
              {result.debtServiceCoverage?.notes&&<div style={{fontSize:10,color:"var(--t4)",marginTop:8,lineHeight:1.5}}>{result.debtServiceCoverage.notes}</div>}
            </div>
          </div>

          {/* Flags, Risks, Recommendations */}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12}}>
            {result.redFlags?.length>0&&<div style={{background:"var(--rbg)",border:"1px solid var(--rbd)",borderRadius:12,padding:"14px 16px"}}>
              <div style={{fontSize:10,fontWeight:800,color:"var(--red)",textTransform:"uppercase",letterSpacing:".07em",marginBottom:8}}>🚩 Red Flags</div>
              {result.redFlags.map((f,i)=><div key={i} style={{fontSize:11,color:"var(--t2)",marginBottom:5,display:"flex",gap:6}}><span style={{color:"var(--red)",flexShrink:0}}>•</span>{f}</div>)}
            </div>}
            {result.keyRisks?.length>0&&<div style={{background:"#fffbeb",border:"1px solid var(--abd)",borderRadius:12,padding:"14px 16px"}}>
              <div style={{fontSize:10,fontWeight:800,color:"var(--amber)",textTransform:"uppercase",letterSpacing:".07em",marginBottom:8}}>⚠️ Key Risks</div>
              {result.keyRisks.map((r,i)=><div key={i} style={{fontSize:11,color:"var(--t2)",marginBottom:5,display:"flex",gap:6}}><span style={{color:"var(--amber)",flexShrink:0}}>•</span>{r}</div>)}
            </div>}
            {result.positives?.length>0&&<div style={{background:"var(--gbg)",border:"1px solid var(--gbd)",borderRadius:12,padding:"14px 16px"}}>
              <div style={{fontSize:10,fontWeight:800,color:"var(--green)",textTransform:"uppercase",letterSpacing:".07em",marginBottom:8}}>✅ Positives</div>
              {result.positives.map((p,i)=><div key={i} style={{fontSize:11,color:"var(--t2)",marginBottom:5,display:"flex",gap:6}}><span style={{color:"var(--green)",flexShrink:0}}>•</span>{p}</div>)}
            </div>}
          </div>

          {result.recommendations?.length>0&&<div style={{background:"var(--white)",border:"1px solid var(--bd)",borderRadius:12,padding:"14px 18px"}}>
            <div style={{fontSize:10,fontWeight:800,color:"var(--t3)",textTransform:"uppercase",letterSpacing:".07em",marginBottom:10}}>📋 Recommended Next Steps</div>
            <div style={{display:"flex",flexDirection:"column",gap:6}}>
              {result.recommendations.map((r,i)=><div key={i} style={{fontSize:12,color:"var(--t2)",display:"flex",gap:10,alignItems:"flex-start"}}>
                <span style={{width:20,height:20,borderRadius:"50%",background:"var(--t1)",color:"#fff",fontSize:9,fontWeight:800,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,marginTop:1}}>{i+1}</span>
                {r}
              </div>)}
            </div>
          </div>}
        </div>}
      </div>
    </div>
    <style>{`@keyframes pulse{0%,60%,100%{opacity:.2}30%{opacity:1}}`}</style>
  </div>);
}

/* ─────────── MARKET DATA ─────────── */
function MarketDataView(){
  const [data,setData]=useState(null);
  const [loading,setLoading]=useState(false);
  const [lastFetched,setLastFetched]=useState(null);
  const [error,setError]=useState(null);

  const fetch_=async()=>{
    setLoading(true);setError(null);
    const prompt=`You are a CRE finance data analyst. Search for and return the latest market data relevant to commercial real estate lending, specifically for multifamily properties in New York. Return a JSON object with this exact structure:

{
  "fetchedAt": "ISO date string",
  "rates": {
    "sofr_30day": {"value": "X.XX%", "change": "+/-X.XX% vs last week", "note": "brief context"},
    "treasury_10yr": {"value": "X.XX%", "change": "+/-X.XX%", "note": "brief context"},
    "treasury_5yr": {"value": "X.XX%", "change": "+/-X.XX%", "note": "brief context"},
    "prime_rate": {"value": "X.XX%", "change": "+/-X.XX%", "note": "brief context"},
    "fed_funds": {"value": "X.XX-X.XX%", "change": "context", "note": "brief context"}
  },
  "cre_lending": {
    "multifamily_agency": {"rate": "X.XX-X.XX%", "spread": "X.XXx over 10yr", "note": "Fannie/Freddie current indicative rates"},
    "multifamily_bank": {"rate": "X.XX-X.XX%", "spread": "over SOFR/Treasury", "note": "regional/community bank market"},
    "bridge": {"rate": "X.XX-X.XX%", "spread": "over SOFR", "note": "bridge/transitional market"},
    "cmbs": {"rate": "X.XX-X.XX%", "note": "conduit/CMBS current market"},
    "debt_fund": {"rate": "X.XX-X.XX%", "note": "debt fund/private credit"}
  },
  "nyc_multifamily": {
    "cap_rates": {"brooklyn": "X.X-X.X%", "queens": "X.X-X.X%", "bronx": "X.X-X.X%", "manhattan": "X.X-X.X%"},
    "vacancy": "X.X% metro area",
    "rent_growth_yoy": "+/-X.X%",
    "market_sentiment": "description of current lending environment"
  },
  "lending_environment": {
    "lender_appetite": "Strong|Moderate|Cautious|Tight",
    "ltv_range": "X-X%",
    "dscr_requirements": "typically X.XX-X.XXx",
    "key_themes": ["theme 1", "theme 2", "theme 3"],
    "headwinds": ["headwind 1", "headwind 2"],
    "tailwinds": ["tailwind 1", "tailwind 2"]
  },
  "analyst_take": "2-3 sentence current market summary for a Brooklyn multifamily owner deciding whether to refinance now or wait"
}

Use web search to get the most current data available. Return ONLY the JSON object.`;

    try{
      const resp=await fetch("https://api.anthropic.com/v1/messages",{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          model:"claude-sonnet-4-20250514",max_tokens:1000,
          tools:[{type:"web_search_20250305",name:"web_search"}],
          messages:[{role:"user",content:prompt}]
        })
      });
      const res=await resp.json();
      const textBlocks=res.content?.filter(b=>b.type==="text")||[];
      const raw=textBlocks.map(b=>b.text).join("");
      const clean=raw.replace(/```json|```/g,"").trim();
      const parsed=JSON.parse(clean);
      parsed.fetchedAt=parsed.fetchedAt||new Date().toISOString();
      setData(parsed);
      setLastFetched(new Date());
    }catch(e){setError(`Failed to fetch market data: ${e.message}`);}
    setLoading(false);
  };

  const appetiteColor=a=>a==="Strong"?"var(--green)":a==="Moderate"?"var(--blue)":a==="Cautious"?"var(--amber)":"var(--red)";

  return(<div>
    <div style={{marginBottom:20,display:"flex",justifyContent:"space-between",alignItems:"flex-end"}}>
      <div>
        <div style={{fontSize:22,fontWeight:700,color:"var(--t1)",marginBottom:4}}>Current Markets</div>
        <div style={{fontSize:13,color:"var(--t3)"}}>Live CRE lending rates, NYC multifamily cap rates, and market conditions — pulled fresh from the web.</div>
      </div>
      <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:6}}>
        {lastFetched&&<div style={{fontSize:10,color:"var(--t4)"}}>Last updated {lastFetched.toLocaleTimeString()}</div>}
        <button onClick={fetch_} disabled={loading} className="btn-dark" style={{fontSize:12}}>
          {loading?"⏳ Fetching…":"⚡ Fetch Live Data"}
        </button>
      </div>
    </div>

    {error&&<div style={{background:"var(--rbg)",border:"1px solid var(--rbd)",borderRadius:12,padding:"14px 16px",marginBottom:16,fontSize:12,color:"var(--red)"}}>{error}</div>}

    {!data&&!loading&&<div style={{background:"var(--white)",border:"2px dashed var(--bd2)",borderRadius:16,padding:"64px 32px",textAlign:"center"}}>
      <div style={{fontSize:40,opacity:.15,marginBottom:12}}>📈</div>
      <div style={{fontSize:15,fontWeight:700,color:"var(--t3)",marginBottom:8}}>No market data loaded</div>
      <div style={{fontSize:12,color:"var(--t4)",marginBottom:20}}>Click "Fetch Live Data" to pull current rates, SOFR, Treasury yields, NYC cap rates, and lender appetite from live sources.</div>
      <button onClick={fetch_} className="btn-dark" style={{fontSize:13}}>⚡ Fetch Live Market Data</button>
    </div>}

    {loading&&<div style={{display:"flex",flexDirection:"column",gap:12}}>
      {[...Array(4)].map((_,i)=><div key={i} style={{height:80,background:"var(--white)",border:"1px solid var(--bd)",borderRadius:14,animation:"shimmer 1.5s infinite",opacity:.6}}/>)}
      <div style={{textAlign:"center",fontSize:12,color:"var(--t3)",marginTop:8}}>Searching live market data sources…</div>
    </div>}

    {data&&!loading&&<div style={{display:"flex",flexDirection:"column",gap:16}}>

      {/* Analyst take */}
      {data.analyst_take&&<div style={{background:"linear-gradient(135deg,#0f172a,#1e293b)",border:"1px solid rgba(255,255,255,.08)",borderRadius:16,padding:"20px 24px"}}>
        <div style={{fontSize:9,fontWeight:800,color:"rgba(212,175,55,.7)",textTransform:"uppercase",letterSpacing:".12em",marginBottom:8}}>ANALYST TAKE — {new Date(data.fetchedAt).toLocaleDateString("en-US",{month:"long",day:"numeric",year:"numeric"})}</div>
        <div style={{fontSize:14,color:"#e2e8f0",lineHeight:1.8,fontStyle:"italic"}}>"{data.analyst_take}"</div>
      </div>}

      {/* Benchmark Rates */}
      <div>
        <div style={{fontSize:12,fontWeight:800,color:"var(--t2)",marginBottom:10,textTransform:"uppercase",letterSpacing:".07em"}}>📊 Benchmark Rates</div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:8}}>
          {data.rates&&Object.entries(data.rates).map(([key,r])=>{
            const labels={sofr_30day:"SOFR 30-Day",treasury_10yr:"10-Year UST",treasury_5yr:"5-Year UST",prime_rate:"Prime Rate",fed_funds:"Fed Funds"};
            const up=r.change?.includes("+");const down=r.change?.includes("-");
            return(<div key={key} style={{background:"var(--white)",border:"1px solid var(--bd)",borderRadius:12,padding:"14px 14px"}}>
              <div style={{fontSize:9,fontWeight:700,color:"var(--t4)",textTransform:"uppercase",letterSpacing:".06em",marginBottom:6}}>{labels[key]||key.replace(/_/g," ")}</div>
              <div style={{fontSize:22,fontWeight:900,color:"var(--t1)",lineHeight:1,marginBottom:4}}>{r.value}</div>
              <div style={{fontSize:10,fontWeight:600,color:up?"var(--red)":down?"var(--green)":"var(--t4)"}}>{r.change}</div>
              {r.note&&<div style={{fontSize:9,color:"var(--t4)",marginTop:5,lineHeight:1.4}}>{r.note}</div>}
            </div>);
          })}
        </div>
      </div>

      {/* CRE Lending Rates */}
      <div>
        <div style={{fontSize:12,fontWeight:800,color:"var(--t2)",marginBottom:10,textTransform:"uppercase",letterSpacing:".07em"}}>🏦 CRE Lending Market</div>
        <div style={{background:"var(--white)",border:"1px solid var(--bd)",borderRadius:14,overflow:"hidden"}}>
          <table style={{width:"100%",borderCollapse:"collapse"}}>
            <thead><tr style={{background:"var(--bg)"}}>
              {["Loan Type","Rate Range","Spread","Notes"].map(h=><th key={h} style={{padding:"10px 16px",textAlign:"left",fontSize:9,fontWeight:700,color:"var(--t3)",textTransform:"uppercase",letterSpacing:".07em",borderBottom:"1px solid var(--bd)"}}>{h}</th>)}
            </tr></thead>
            <tbody>
              {data.cre_lending&&Object.entries(data.cre_lending).map(([key,r],i)=>{
                const labels={multifamily_agency:"Multifamily Agency (F/F)",multifamily_bank:"Multifamily Bank/CU",bridge:"Bridge / Transitional",cmbs:"CMBS / Conduit",debt_fund:"Debt Fund / Private"};
                return(<tr key={key} style={{borderBottom:"1px solid var(--bd)",background:i%2===0?"transparent":"var(--bg)"}}>
                  <td style={{padding:"12px 16px",fontSize:12,fontWeight:700,color:"var(--t1)"}}>{labels[key]||key}</td>
                  <td style={{padding:"12px 16px",fontSize:14,fontWeight:800,color:"var(--blue)",fontFamily:"monospace"}}>{r.rate||"—"}</td>
                  <td style={{padding:"12px 16px",fontSize:11,color:"var(--t3)"}}>{r.spread||"—"}</td>
                  <td style={{padding:"12px 16px",fontSize:11,color:"var(--t4)",maxWidth:200}}>{r.note||""}</td>
                </tr>);
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* NYC Multifamily + Lending Environment */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
        {/* NYC Cap Rates */}
        {data.nyc_multifamily&&<div style={{background:"var(--white)",border:"1px solid var(--bd)",borderRadius:14,padding:"16px 18px"}}>
          <div style={{fontSize:10,fontWeight:800,color:"var(--t3)",textTransform:"uppercase",letterSpacing:".07em",marginBottom:12}}>🗽 NYC Multifamily</div>
          <div style={{marginBottom:12}}>
            <div style={{fontSize:9,fontWeight:700,color:"var(--t4)",marginBottom:6}}>CAP RATES BY BOROUGH</div>
            {data.nyc_multifamily.cap_rates&&Object.entries(data.nyc_multifamily.cap_rates).map(([borough,rate])=>(
              <div key={borough} style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:"1px solid var(--bd)",fontSize:11}}>
                <span style={{color:"var(--t3)",textTransform:"capitalize"}}>{borough}</span>
                <span style={{fontWeight:700,color:"var(--t1)"}}>{rate}</span>
              </div>
            ))}
          </div>
          {[{l:"Metro Vacancy",v:data.nyc_multifamily.vacancy},{l:"Rent Growth YoY",v:data.nyc_multifamily.rent_growth_yoy}].map((r,i)=>(
            <div key={i} style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:"1px solid var(--bd)",fontSize:11}}>
              <span style={{color:"var(--t3)"}}>{r.l}</span><span style={{fontWeight:700,color:"var(--t1)"}}>{r.v||"—"}</span>
            </div>
          ))}
          {data.nyc_multifamily.market_sentiment&&<div style={{marginTop:10,fontSize:10,color:"var(--t3)",lineHeight:1.6,padding:"8px 10px",background:"var(--bg)",borderRadius:8}}>{data.nyc_multifamily.market_sentiment}</div>}
        </div>}

        {/* Lending Environment */}
        {data.lending_environment&&<div style={{background:"var(--white)",border:"1px solid var(--bd)",borderRadius:14,padding:"16px 18px"}}>
          <div style={{fontSize:10,fontWeight:800,color:"var(--t3)",textTransform:"uppercase",letterSpacing:".07em",marginBottom:12}}>🏛️ Lending Environment</div>
          <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:14,padding:"10px 12px",borderRadius:10,background:appetiteColor(data.lending_environment.lender_appetite)+"20",border:`1px solid ${appetiteColor(data.lending_environment.lender_appetite)}40`}}>
            <div style={{flex:1}}><div style={{fontSize:9,fontWeight:700,color:"var(--t4)",textTransform:"uppercase",letterSpacing:".07em",marginBottom:2}}>Lender Appetite</div>
            <div style={{fontSize:16,fontWeight:800,color:appetiteColor(data.lending_environment.lender_appetite)}}>{data.lending_environment.lender_appetite}</div></div>
          </div>
          {[{l:"LTV Range",v:data.lending_environment.ltv_range},{l:"DSCR Requirements",v:data.lending_environment.dscr_requirements}].map((r,i)=>(
            <div key={i} style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:"1px solid var(--bd)",fontSize:11}}>
              <span style={{color:"var(--t3)"}}>{r.l}</span><span style={{fontWeight:700,color:"var(--t1)"}}>{r.v||"—"}</span>
            </div>
          ))}
          {data.lending_environment.key_themes?.length>0&&<><div style={{fontSize:9,fontWeight:700,color:"var(--t4)",textTransform:"uppercase",letterSpacing:".07em",marginTop:10,marginBottom:6}}>Key Themes</div>
            {data.lending_environment.key_themes.map((t,i)=><div key={i} style={{fontSize:10,color:"var(--t2)",marginBottom:3,display:"flex",gap:6}}><span style={{color:"var(--blue)"}}>→</span>{t}</div>)}</>}
          {data.lending_environment.headwinds?.length>0&&<><div style={{fontSize:9,fontWeight:700,color:"var(--red)",textTransform:"uppercase",letterSpacing:".07em",marginTop:10,marginBottom:6}}>Headwinds</div>
            {data.lending_environment.headwinds.map((h,i)=><div key={i} style={{fontSize:10,color:"var(--t2)",marginBottom:2,display:"flex",gap:6}}><span style={{color:"var(--red)"}}>↓</span>{h}</div>)}</>}
          {data.lending_environment.tailwinds?.length>0&&<><div style={{fontSize:9,fontWeight:700,color:"var(--green)",textTransform:"uppercase",letterSpacing:".07em",marginTop:10,marginBottom:6}}>Tailwinds</div>
            {data.lending_environment.tailwinds.map((t,i)=><div key={i} style={{fontSize:10,color:"var(--t2)",marginBottom:2,display:"flex",gap:6}}><span style={{color:"var(--green)"}}>↑</span>{t}</div>)}</>}
        </div>}
      </div>
    </div>}
    <style>{`@keyframes shimmer{0%,100%{opacity:.4}50%{opacity:.7}}`}</style>
  </div>);
}

export default function App(){
  const [loans,setLoans]=useState(LOANS_INIT);
  const [view,setView]=useState("overview");
  const [sbFilt,setSbFilt]=useState("all");
  const [detail,setDetail]=useState(null);
  const [adding,setAdding]=useState(false);
  const [editing,setEditing]=useState(null);
  const [sbSearch,setSbSearch]=useState("");
  const [loaded,setLoaded]=useState(false);
  const [navGroups,setNavGroups]=useState({risk:true,maturities:true,relationships:true,intelligence:true});
  const [user,setUser]=useState(null);

  // Get current user
  useEffect(()=>{
    if(!supabase)return;
    supabase.auth.getUser().then(({data:{user}})=>setUser(user));
    const {data:{subscription}}=supabase.auth.onAuthStateChange((_,s)=>setUser(s?.user||null));
    return()=>subscription.unsubscribe();
  },[]);

  const signOut=async()=>{
    if(supabase)await supabase.auth.signOut();
  };

  // ── helpers: map DB row → app loan object ──────────────────────────────────
  const dbRowToLoan = r => ({
    id:               r.id,
    addr:             r.addr||"",
    lender:           r.lender||"",
    entity:           r.entity||"",
    origBalance:      Number(r.orig_balance)||0,       // Original Loan from Excel
    currentBalance:   Number(r.current_balance)||Number(r.orig_balance)||0, // Current Balance from Excel
    origDate:         r.close_date||"",
    rate:             Number(r.rate)||0,                // Full decimal e.g. 6.669
    termMonths:       r.term_months!=null ? Number(r.term_months) : null,
    termYears:        r.term_months!=null ? Number(r.term_months)/12 : null,
    amortYears:       30,
    maturityDate:     r.maturity_date||"",
    ppp:              r.ppp||"",
    prepay:           r.ppp||"",
    ioPeriodMonths:   r.io_period_months!=null ? Number(r.io_period_months) : null,
    interestOnly:     r.io_period_months!=null && r.io_period_months > 0,
    loanType:         (r.io_period_months!=null && r.io_period_months > 0) ? "IO" : "Fixed",
    recourse:         false,
    dscrCovenant:     null,
    annualNOI:        null,
    refiStatus:       r.refi_status||"Not Started",
    notes:            r.notes||"",
    activityLog:      r.activity_log||[]
  });
  const loanToDbRow = l => ({
    addr:             l.addr,
    lender:           l.lender,
    entity:           l.entity||"",
    orig_balance:     l.origBalance||0,
    current_balance:  l.currentBalance||l.origBalance||0,
    close_date:       l.origDate||null,
    rate:             l.rate||0,
    term_months:      l.termMonths||(l.termYears?Math.round(l.termYears*12):null),
    maturity_date:    l.maturityDate||null,
    ppp:              l.ppp||l.prepay||"",
    io_period_months: l.ioPeriodMonths||(l.interestOnly&&l.termMonths?l.termMonths:null),
    refi_status:      l.refiStatus||"Not Started",
    notes:            l.notes||"",
    activity_log:     l.activityLog||[]
  });

  const [dbStatus,setDbStatus]=useState("loading");
  const [dbError,setDbError]=useState("");

  // ── load loans from DB ─────────────────────────────────────────────────────
  useEffect(()=>{(async()=>{
    try{
      if(supabase){
        const {data:{user},error:authErr}=await supabase.auth.getUser();
        if(authErr||!user){setDbStatus("error");setDbError("Not authenticated");setLoaded(true);return;}
        const {data,error}=await supabase.from("loans").select("*").order("id");
        if(error){
          setDbStatus("error");
          setDbError(error.message);
          console.error("loans load error:",error);
        } else if(data && data.length>0){
          setLoans(data.map(dbRowToLoan));
          setDbStatus("connected");
        } else {
          setDbStatus("empty");
        }
      } else {
        const r=await supaStorage.get("meridian-v5");
        if(r?.value){const p=JSON.parse(r.value);if(Array.isArray(p)&&p.length>0){setLoans(p);setDbStatus("connected");}}
        else setDbStatus("empty");
      }
    }catch(e){setDbStatus("error");setDbError(e.message);console.error("load loans:",e);}
    setLoaded(true);
  })();},[]);

  // ── CRUD — each operation hits the DB directly ─────────────────────────────
  const addLoan=async l=>{
    if(supabase){
      try{
        const {data:{user}}=await supabase.auth.getUser();
        const {data,error}=await supabase.from("loans").insert({...loanToDbRow(l),user_id:user.id}).select().single();
        if(!error&&data) setLoans(p=>[...p,dbRowToLoan(data)]);
      }catch(e){console.error("addLoan:",e); setLoans(p=>[...p,l]);}
    } else { setLoans(p=>[...p,l]); }
  };

  const saveLoan=async(id,ch)=>{
    setLoans(p=>p.map(l=>{
      if(l.id!==id)return l;
      if(ch.actAdd)return{...l,activityLog:[...(l.activityLog||[]),ch.actAdd]};
      if(ch.actDel)return{...l,activityLog:(l.activityLog||[]).filter(e=>e.id!==ch.actDel)};
      return{...l,...ch};
    }));
    if(supabase){
      try{
        const updated=await new Promise(res=>setLoans(p=>{const l=p.find(x=>x.id===id);res(l);return p;}));
        const loan=ch.actAdd||ch.actDel
          ? (() => { let l=null; setLoans(p=>{l=p.find(x=>x.id===id);return p;}); return l; })()
          : null;
        // re-read from state after update
        setTimeout(async()=>{
          setLoans(p=>{
            const l=p.find(x=>x.id===id);
            if(l&&supabase) supabase.from("loans").update(loanToDbRow(l)).eq("id",id).then(()=>{});
            return p;
          });
        },100);
      }catch(e){console.error("saveLoan:",e);}
    }
  };

  const deleteLoan=async id=>{
    setLoans(p=>p.filter(l=>l.id!==id));
    setDetail(null);
    if(supabase){
      try{ await supabase.from("loans").delete().eq("id",id); }
      catch(e){console.error("deleteLoan:",e);}
    }
  };

  // CSV export for entire portfolio
  const exportPortfolioCSV=()=>{
    const en=loans.map(enrich);
    downloadCSV("meridian-portfolio.csv",
      ["Address","Entity","Lender","Type","Orig Balance","Cur Balance","Rate","Monthly Pmt","Annual DS","Maturity","Days Left","Status","Refi Status","Prepay","NOI","DSCR","Recourse"],
      en.map(l=>[l.addr,l.entity||"",l.lender,l.loanType,l.origBalance,l.curBal.toFixed(0),l.rate,l.pmt.toFixed(0),l.annualDS.toFixed(0),l.maturityDate,l.daysLeft,l.status,l.refiStatus||"",l.prepay||"",l.annualNOI||"",l.dscr?l.dscr.toFixed(2):"",l.recourse?"Yes":"No"])
    );
  };

  const en=useMemo(()=>loans.map(enrich),[loans]);
  const counts={urgent:en.filter(l=>l.status==="urgent"||l.status==="matured").length,soon:en.filter(l=>l.status==="soon").length,ok:en.filter(l=>l.status==="ok").length};

  // Live alert count for nav badge (evaluate maturity + overdue rules inline)
  const liveAlertCount=useMemo(()=>{
    const maturityUrgent=en.filter(l=>l.daysLeft>=0&&l.daysLeft<=90).length;
    const overdue=en.filter(l=>l.daysLeft<0).length;
    return maturityUrgent+overdue;
  },[en]);
  const sbLoans=sbSearch?loans.filter(l=>l.addr.toLowerCase().includes(sbSearch.toLowerCase())||l.lender.toLowerCase().includes(sbSearch.toLowerCase())):loans;
  const openLoan=raw=>{setDetail(raw);setSbSearch("");};
  const detailRaw=detail?loans.find(l=>l.id===detail.id)||detail:null;
  const topbarTitle=detail?detailRaw.addr:view==="overview"?"Portfolio Overview":view==="loans"?"All Loans":view==="calc"?"Refi Calculator":view==="pipeline"?"Refinancing Pipeline":view==="cashflow"?"Cashflow Impact":view==="noidscr"?"NOI & DSCR Tracker":view==="covenant"?"Covenant Monitor":view==="ratecap"?"Rate Cap Tracker":view==="alerts"?"🔔 Alert System":view==="lendercrm"?"Lender Relationships":view==="contacts"?"Contacts":view==="propdocs"?"🗂️ Property Documents":view==="stmtanalyzer"?"📈 Statement Analyzer":view==="markets"?"📊 Current Markets":view==="docai"?"✨ Doc Abstractor AI":view==="timeline"?"Maturity Timeline":view==="schedule"?"Loan Maturity Schedule":"Lender Exposure";

  return(<AuthGate>
    <>
    <style>{CSS}</style>
    <style>{`
      /* Force full-page fill regardless of artifact/browser mount point */
      body,html{height:100%!important;width:100%!important;margin:0!important;padding:0!important;overflow:hidden!important;}
      body>div,body>div>div{height:100%!important;width:100%!important;}
    `}</style>
    <div className="shell">

      {/* ── SIDEBAR ── */}
      <div className="sb">
        <div className="sb-hd">
          <div className="sb-brand">
            <img src={LOGO} alt="Meridian Properties" style={{width:"100%",maxWidth:200,height:"auto",display:"block",margin:"0 auto 6px",filter:"brightness(1.05)"}}/>
            <div className="sb-firm-type" style={{textAlign:"center"}}>Brooklyn, New York</div>
            <div className="sb-firm-rule"/>
            <div className="sb-firm-meta">Debt Management · {new Date().getFullYear()}</div>
          </div>
        </div>
        <div style={{padding:"10px 14px 4px",borderBottom:"1px solid var(--sb-bd)"}}>
          <div className="sb-search">
            <span className="sb-si">🔍</span>
            <input placeholder="Search buildings…" value={sbSearch} onChange={e=>setSbSearch(e.target.value)}/>
          </div>
        </div>

        <div className="sb-nav">
          {/* Search results */}
          {sbSearch?(<>
            <div className="sb-sec">Results</div>
            {sbLoans.slice(0,8).map(l=>{const el=enrich(l);return(
              <div key={l.id} className="sb-row" onClick={()=>openLoan(l)}>
                <div className="sb-rl">
                  <div className="sb-rtxt">
                    <div className="sb-rlbl" style={{fontSize:11}}>{l.addr}</div>
                    <div className="sb-rsub">{fPct(l.rate)} · {fDateS(l.maturityDate)}</div>
                  </div>
                </div>
                <span className={`sb-badge ${el.status==="matured"||el.status==="urgent"?"bg-red":el.status==="soon"?"bg-amber":"bg-green"}`}>
                  {el.status==="matured"?"!":el.status==="urgent"?"⚡":el.status==="soon"?"~":"✓"}
                </span>
              </div>
            );})}
          </>):(<>

            {/* ── PINNED (no group header) ── */}
            {[
              {id:"overview",icon:"⊞",label:"Overview",sub:null},
              {id:"loans",icon:"📋",label:"All Loans",sub:`${loans.length} loan${loans.length!==1?"s":""}`},
            ].map(n=>(
              <div key={n.id} className={`sb-row${view===n.id&&!detail?" act":""}`} onClick={()=>{setView(n.id);setDetail(null);}}>
                <div className="sb-rl">
                  <span className="sb-ri">{n.icon}</span>
                  <div className="sb-rtxt">
                    <div className="sb-rlbl">{n.label}</div>
                    {n.sub&&<div className="sb-rsub">{n.sub}</div>}
                  </div>
                </div>
              </div>
            ))}

            <div className="sb-div" style={{margin:"8px 10px 6px"}}/>

            {/* ── GROUPED NAV ── */}
            {[
              {
                id:"risk", label:"Risk", icon:"⚠️",
                items:[
                  {id:"alerts",icon:"🔔",label:"Alert System",badge:liveAlertCount>0?liveAlertCount:null,bc:"bg-red"},
                  {id:"covenant",icon:"🛡️",label:"Covenant Monitor",badge:loans.filter(l=>l.dscrCovenant).length>0?loans.filter(l=>l.dscrCovenant).length:null,bc:"bg-grey"},
                  {id:"ratecap",icon:"📉",label:"Rate Cap",badge:loans.filter(l=>l.loanType==="ARM"||l.loanType==="SOFR").length||null,bc:"bg-grey"},
                  {id:"noidscr",icon:"📊",label:"NOI & DSCR Tracker",badge:null},
                ],
              },
              {
                id:"maturities", label:"Maturities & Exits", icon:"🗓",
                items:[
                  {id:"timeline",icon:"📅",label:"Timeline",badge:null},
                  {id:"schedule",icon:"🗓",label:"Schedule",badge:counts.urgent>0?counts.urgent:null,bc:"bg-red"},
                  {id:"calc",icon:"🧮",label:"Refi Calculator",badge:null},
                  {id:"pipeline",icon:"🔄",label:"Refi Pipeline",badge:null},
                  {id:"cashflow",icon:"💵",label:"Cashflow Impact",badge:null},
                ],
              },
              {
                id:"relationships", label:"Relationships", icon:"🤝",
                items:[
                  {id:"lendercrm",icon:"🤝",label:"Lender CRM",badge:null},
                  {id:"exposure",icon:"🏦",label:"Lender Exposure",badge:null},
                  {id:"contacts",icon:"👤",label:"Contacts",badge:null},
                  {id:"docai",icon:"✨",label:"Doc Abstractor AI",badge:null},
                ],
              },
              {
                id:"intelligence", label:"Intelligence", icon:"🧠",
                items:[
                  {id:"propdocs",icon:"🗂️",label:"Property Documents",badge:null},
                  {id:"stmtanalyzer",icon:"📈",label:"Statement Analyzer",badge:null},
                  {id:"markets",icon:"📊",label:"Current Markets",badge:null},
                ],
              },
            ].map(group=>{
              const isOpen=navGroups[group.id]!==false; // default open
              const hasActive=group.items.some(n=>n.id===view&&!detail);
              return(
                <div key={group.id} className="sb-group">
                  <div className="sb-group-hd" onClick={()=>setNavGroups(p=>({...p,[group.id]:!isOpen}))}>
                    <div className="sb-group-label">
                      <span className="sb-group-icon">{group.icon}</span>
                      {group.label}
                      {hasActive&&<span style={{width:4,height:4,borderRadius:"50%",background:"#60a5fa",display:"inline-block"}}/>}
                    </div>
                    <span className={`sb-group-caret${isOpen?" open":""}`}>▶</span>
                  </div>
                  {isOpen&&<div className="sb-group-items">
                    {group.items.map(n=>(
                      <div key={n.id} className={`sb-row${view===n.id&&!detail?" act":""}`} onClick={()=>{setView(n.id);setDetail(null);}}>
                        <div className="sb-rl">
                          <span className="sb-ri" style={{fontSize:13}}>{n.icon}</span>
                          <div className="sb-rtxt">
                            <div className="sb-rlbl" style={{fontSize:11.5}}>{n.label}</div>
                          </div>
                        </div>
                        {n.badge&&<span className={`sb-badge ${n.bc||"bg-grey"}`}>{n.badge}</span>}
                      </div>
                    ))}
                  </div>}
                </div>
              );
            })}

            {/* Maturity quick-filter */}
            <div className="sb-div" style={{margin:"8px 10px 6px"}}/>
            <div className="sb-sec" style={{padding:"4px 8px 5px"}}>Quick Filter</div>
            {[
              {id:"urgent",icon:"🔴",label:"Urgent / Overdue",badge:counts.urgent,bc:counts.urgent>0?"bg-red":"bg-grey"},
              {id:"soon",icon:"🕐",label:"Due Soon",badge:counts.soon,bc:counts.soon>0?"bg-amber":"bg-grey"},
              {id:"ok",icon:"✅",label:"Current",badge:counts.ok,bc:"bg-green"},
            ].map(f=>(
              <div key={f.id} className={`sb-row${view==="loans"&&sbFilt===f.id&&!detail?" act":""}`}
                onClick={()=>{setView("loans");setSbFilt(f.id);setDetail(null);}}>
                <div className="sb-rl">
                  <span className="sb-ri" style={{fontSize:12}}>{f.icon}</span>
                  <div className="sb-rtxt"><div className="sb-rlbl" style={{fontSize:11.5}}>{f.label}</div></div>
                </div>
                <span className={`sb-badge ${f.bc}`}>{f.badge}</span>
              </div>
            ))}
          </>)}
        </div>

        <div className="sb-ft">
          <div className="sb-user">
            <div className="sb-av">{user?.user_metadata?.full_name?.[0]||user?.email?.[0]?.toUpperCase()||"M"}</div>
            <div style={{flex:1,minWidth:0}}>
              <div className="sb-uname" style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{user?.user_metadata?.full_name||user?.email?.split("@")[0]||"Management"}</div>
              <div className="sb-urole">{user?.email||"Brooklyn Portfolio"}</div>
            </div>
            {supabase&&<button onClick={signOut} title="Sign out" style={{background:"none",border:"none",cursor:"pointer",color:"var(--sb-t3)",fontSize:14,padding:"4px",flexShrink:0,opacity:.7,transition:"opacity .15s"}}
              onMouseEnter={e=>e.currentTarget.style.opacity="1"}
              onMouseLeave={e=>e.currentTarget.style.opacity=".7"}>
              ⎋
            </button>}
          </div>
        </div>
      </div>

      {/* ── MAIN ── */}
      <div className="main">
        <div className="topbar">
          <div className="tb-title">{topbarTitle}</div>
          <div className="tb-right">
            {detail&&<button className="btn-light" onClick={()=>setDetail(null)}>← Back</button>}
            {detail&&<button className="btn-light" onClick={()=>setAdding(true)}>+ Log Activity</button>}
            {!detail&&view!=="calc"&&<>
              {(view==="loans"||view==="overview")&&loans.length>0&&<button className="btn-light" onClick={exportPortfolioCSV}>⬇ Export CSV</button>}
              <button className="btn-dark" onClick={()=>setAdding(true)}>+ Add Loan</button>
            </>}
          </div>
        </div>

        <div className="carea">
          {detail
            ? <LoanDetail
                raw={detailRaw}
                onBack={()=>setDetail(null)}
                onSave={(id,ch)=>saveLoan(id,ch)}
                onEdit={()=>setEditing(detailRaw)}
                onDelete={()=>deleteLoan(detailRaw.id)}
              />
            : view==="overview"?<Overview loans={loans} onSelect={openLoan} onAdd={()=>setAdding(true)} dbStatus={dbStatus} dbError={dbError}/>
            : view==="loans"?<AllLoans loans={loans} onSelect={openLoan} onAdd={()=>setAdding(true)}/>
            : view==="calc"?<RefiCalc loans={loans}/>
            : view==="pipeline"?<RefiPipeline loans={loans} onSelect={openLoan} onSave={saveLoan}/>
            : view==="cashflow"?<CashflowImpact loans={loans} onSelect={openLoan}/>
            : view==="noidscr"?<NOIDSCRTracker loans={loans} onSelect={openLoan}/>
            : view==="covenant"?<CovenantMonitor loans={loans} onSelect={openLoan}/>
            : view==="alerts"?<AlertSystem loans={loans}/>
            : view==="ratecap"?<RateCapTracker loans={loans} onSelect={openLoan}/>
            : view==="lendercrm"?<LenderCRM loans={loans} onSelect={openLoan}/>
            : view==="contacts"?<ContactsView loans={loans} onSelect={openLoan}/>
            : view==="propdocs"?<DocumentsView loans={loans}/>
            : view==="stmtanalyzer"?<StatementAnalyzer loans={loans}/>
            : view==="markets"?<MarketDataView/>
            : view==="docai"?<LoanDocAbstract loans={loans} onSelect={openLoan}/>
            : view==="timeline"?<MaturityTimeline loans={loans} onSelect={openLoan}/>
            : view==="schedule"?<LoanMaturitySchedule loans={loans} onSelect={openLoan}/>
            : view==="exposure"?<LenderExposure loans={loans} onSelect={openLoan}/>
            : null
          }
        </div>
      </div>
    </div>

    {/* Add Loan Modal */}
    {adding&&!detail&&<LoanModal onSave={l=>{addLoan(l);setAdding(false);}} onClose={()=>setAdding(false)}/>}

    {/* Edit Loan Modal */}
    {editing&&<LoanModal initial={editing} onSave={(id,ch)=>{saveLoan(id,ch);setEditing(null);}} onClose={()=>setEditing(null)}/>}

    {/* Log Activity Modal (from detail view) */}
    {adding&&detail&&<div className="ov-modal" onClick={e=>e.target===e.currentTarget&&setAdding(false)}>
      <div className="ov-mbox">
        <div className="ov-mhd"><div className="ov-mtitle">Log Activity — {detailRaw.addr}</div><button className="ov-mclose" onClick={()=>setAdding(false)}>✕</button></div>
        <div className="ov-mbody">
          <ActivityLog log={detailRaw.activityLog||[]} onAdd={e=>{saveLoan(detailRaw.id,{actAdd:e});}} onDel={id=>saveLoan(detailRaw.id,{actDel:id})}/>
        </div>
      </div>
    </div>}
  </>
  </AuthGate>);
}  const [authMode, setAuthMode] = useState("login"); // login | signup | reset
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!supabase) { setSession(null); return; }
    supabase.auth.getSession().then(({ data: { session } }) => setSession(session));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => subscription.unsubscribe();
  }, []);

  // No Supabase configured — run in local mode (window.storage fallback)
  if (!supabase || (SUPA_URL === "" && SUPA_KEY === "")) {
    return children;
  }

  // Loading
  if (session === undefined) {
    return (
      <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100vh",background:"#0f172a"}}>
        <div style={{fontSize:13,color:"#475569"}}>Loading…</div>
      </div>
    );
  }

  // Authenticated — render app
  if (session) return children;

  // ── Auth forms ──
  const submit = async () => {
    setBusy(true); setError(""); setInfo("");
    try {
      if (authMode === "login") {
        const { error: e } = await supabase.auth.signInWithPassword({ email, password });
        if (e) setError(e.message);
      } else if (authMode === "signup") {
        const { error: e } = await supabase.auth.signUp({ email, password, options: { data: { full_name: name } } });
        if (e) setError(e.message);
        else setInfo("Check your email to confirm your account, then log in.");
      } else {
        const { error: e } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.href });
        if (e) setError(e.message);
        else setInfo("Password reset email sent. Check your inbox.");
      }
    } catch(e) { setError(e.message); }
    setBusy(false);
  };

  return (
    <div style={{display:"flex",alignItems:"center",justifyContent:"center",width:"100vw",height:"100vh",minHeight:"100vh",background:"#0f172a",fontFamily:"Inter,system-ui,sans-serif",position:"fixed",top:0,left:0,right:0,bottom:0}}>
      <div style={{width:"100%",maxWidth:420,padding:"0 24px"}}>
        {/* Brand */}
        <div style={{marginBottom:32,textAlign:"center"}}>
          <img src={LOGO} alt="Meridian Properties" style={{width:"100%",maxWidth:320,height:"auto",display:"block",margin:"0 auto 12px"}}/>
          <div style={{fontSize:10,color:"#334155",letterSpacing:".18em",textTransform:"uppercase"}}>Mortgage Portfolio OS</div>
        </div>

        {/* Card */}
        <div style={{background:"#1e293b",border:"1px solid rgba(255,255,255,.07)",borderRadius:16,padding:"28px 28px 24px",boxShadow:"0 20px 60px rgba(0,0,0,.4)"}}>
          <div style={{fontSize:16,fontWeight:700,color:"#f1f5f9",marginBottom:4}}>
            {authMode==="login"?"Sign in":authMode==="signup"?"Create account":"Reset password"}
          </div>
          <div style={{fontSize:11,color:"#64748b",marginBottom:22}}>
            {authMode==="login"?"Access your portfolio dashboard":authMode==="signup"?"Set up your team account":"We'll email you a reset link"}
          </div>

          {authMode==="signup"&&<div style={{marginBottom:12}}>
            <label style={{fontSize:11,fontWeight:600,color:"#94a3b8",display:"block",marginBottom:5,letterSpacing:".04em"}}>FULL NAME</label>
            <input value={name} onChange={e=>setName(e.target.value)} placeholder="Maria Lopez"
              style={{width:"100%",padding:"10px 14px",background:"#0f172a",border:"1px solid rgba(255,255,255,.1)",borderRadius:9,fontSize:13,color:"#f1f5f9",outline:"none"}}/>
          </div>}

          <div style={{marginBottom:12}}>
            <label style={{fontSize:11,fontWeight:600,color:"#94a3b8",display:"block",marginBottom:5,letterSpacing:".04em"}}>EMAIL</label>
            <input value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@meridian.com" type="email" onKeyDown={e=>e.key==="Enter"&&submit()}
              style={{width:"100%",padding:"10px 14px",background:"#0f172a",border:"1px solid rgba(255,255,255,.1)",borderRadius:9,fontSize:13,color:"#f1f5f9",outline:"none"}}/>
          </div>

          {authMode!=="reset"&&<div style={{marginBottom:20}}>
            <label style={{fontSize:11,fontWeight:600,color:"#94a3b8",display:"block",marginBottom:5,letterSpacing:".04em"}}>PASSWORD</label>
            <input value={password} onChange={e=>setPassword(e.target.value)} placeholder="••••••••••••" type="password" onKeyDown={e=>e.key==="Enter"&&submit()}
              style={{width:"100%",padding:"10px 14px",background:"#0f172a",border:"1px solid rgba(255,255,255,.1)",borderRadius:9,fontSize:13,color:"#f1f5f9",outline:"none"}}/>
          </div>}

          {error&&<div style={{padding:"9px 13px",background:"rgba(220,38,38,.15)",border:"1px solid rgba(220,38,38,.3)",borderRadius:8,fontSize:12,color:"#fca5a5",marginBottom:14}}>{error}</div>}
          {info&&<div style={{padding:"9px 13px",background:"rgba(22,163,74,.15)",border:"1px solid rgba(22,163,74,.3)",borderRadius:8,fontSize:12,color:"#86efac",marginBottom:14}}>{info}</div>}

          <button onClick={submit} disabled={busy}
            style={{width:"100%",padding:"11px",background:busy?"#334155":"linear-gradient(135deg,#2563eb,#1d4ed8)",border:"none",borderRadius:10,color:"#fff",fontSize:13,fontWeight:700,cursor:busy?"default":"pointer",letterSpacing:".02em",boxShadow:busy?"none":"0 4px 14px rgba(37,99,235,.3)"}}>
            {busy?"Working…":authMode==="login"?"Sign In →":authMode==="signup"?"Create Account →":"Send Reset Email"}
          </button>

          <div style={{marginTop:18,display:"flex",justifyContent:"center",gap:20,fontSize:11}}>
            {authMode!=="login"&&<button onClick={()=>{setAuthMode("login");setError("");setInfo("");}} style={{background:"none",border:"none",color:"#64748b",cursor:"pointer",textDecoration:"underline"}}>Sign in</button>}
            {authMode!=="signup"&&<button onClick={()=>{setAuthMode("signup");setError("");setInfo("");}} style={{background:"none",border:"none",color:"#64748b",cursor:"pointer",textDecoration:"underline"}}>Create account</button>}
            {authMode!=="reset"&&<button onClick={()=>{setAuthMode("reset");setError("");setInfo("");}} style={{background:"none",border:"none",color:"#64748b",cursor:"pointer",textDecoration:"underline"}}>Forgot password</button>}
          </div>
        </div>

        <div style={{textAlign:"center",marginTop:20,fontSize:10,color:"#334155"}}>
          Meridian Properties · Internal Use Only
        </div>
      </div>
    </div>
  );
}

const LOGO = "data:image/png;base64,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sczD7CY7hcInaGvI5sYf9z2n2/8AV9cDa92jn4skqsCYErHMw+wmO4XCJ2hryObGH/c9p9v/AFfXVZREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBEUo2PZ9zhvdlorza8FVFTQV1OyppphV04Ekb2hzXaGQEagg8Rqgi5FLve053+IVT8tpvrE72nO/xCqfltN9YgiJFLve053+IVT8tpvrE72nO/xCqfltN9YgiJFLve053+IVT8tpvrE72nO/xCqfltN9YgiJFLve053+IVT8tpvrE72nO/xCqfltN9YgiJFLve053+IVT8tpvrE72nO/xCqfltN9YgiJFLve053+IVT8tpvrE72nO/xCqfltN9YgiJFLve053+IVT8tpvrE72nO/xCqfltN9YgiJFLve053+IVT8tpvrE72nO/xCqfltN9YgiJFLve053+IVT8tpvrE72nO/xCqfltN9YgiJFLve053+IVT8tpvrE72nO/xCqfltN9YgiJFLve053+IVT8tpvrE72nO/xCqfltN9YgiJFLve053+IVT8tpvrE72nO/xCqfltN9YgiJFLve053+IVT8tpvrE72nO/xCqfltN9YgiJFLve053+IVT8tpvrE72nO/xCqfltN9YgiJFLve053+IVT8tpvrE72nO/xCqfltN9YgiJFLve053+IVT8tpvrE72nO/xCqfltN9YgiJT/s/Zw9ydz4TxZVfwbhHQ10jvuXUI5D+D2O6uR4csd72nO/xCqfltN9Yne053+IVT8tpvrFS39Cnepmq2PpPvE+YTUX5059WK2JC4KqWGmp5KiolZFDE0vkke4Na1oGpJJ5ALDMj8K502WgFgxrgyvNBAz+CV3dMMr4gP/DcGvLnDsIBI5cuXiZ64Ez0xfM+x2DA9dDYWO8N5q6dj6wjrcDJqGDqafOeoDn1f9N7c7f6fKP9Mf3e3L/PyZ3LiFUVdcd/CIc9c15cV1ElisUr4rFE7R7xqHVbgeZ7Gdg6+Z6gIkUu97Tnf4hVPy2m+sTvac7/ABCqfltN9YuiaenVp1RVVHKI/wC/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4w+e6n6aeqnmd7o+MPnup+msPRBmHqp5ne6PjD57qfpp6qeZ3uj4w+e6n6aw9EGYeqnmd7o+MPnup+mnqp5ne6PjD57qfprD0QZZVZl5j1dLLS1WYGLJ6eZhjlikvFQ5j2kaFrgX6EEHQgrE0RAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQEREBERAREQd0Wm6Eai21hB/wCA7/RdeppqimcGVMEsLjyEjC0/lWxHaYzqv2TuG8GyWO1Wy4G6wytlFYH+B0TIdN3dcOfSHXXsCjvKzafp8zsW0GAsxsC2WegvUwpIpImmRjZX8GB0cm9qCdBqCCNdUFLV9RsfLI2ONjnvcdGtaNST5ApL2nsBUGXGct3w7ad4WsiOqomPcXGOORu9uanid1280E8SANeK6Wzh7PeB/fum/aBBhnpTdf5srf8AoO/0XzJbLlHG6SS31bGNGrnOhcAB2ngr17TW0lirKzMw4Ws9istbTChiqelqhLv7zy7UeC4DTh2KGcZbXuNsUYRvGG6vDOHoae60M1FLJEJt9jZWFhLdXkagHhqgreiLlo6aesq4aSlifNUTyNjijYNXPc46AAdpJQfUdJVyU7qiOlnfC3XekbGS0ac9TyXAtl+X9Pg/LmzYRyCurYp7he7NVSVbNRuTSEazB3WQ/WYN8kWnYtfObWDqvAOY17wlWbxdb6pzIpHDQywnwo3/AOJhafhQYsuaOkqpKd1RHTTPhZrvSNYS0adp5LhVxtnn7xDMj+0uP7rCgpyiIgIiIOzT0FdUR9JT0VTMzXTeZE5w184C5PSm6/zZW/8AQd/orsbL+KazBOxffsV0FPBU1VsrKqeKKfXceR0Y0OhB049RWAd+1j7xTwz8U/1iCr1TTz00nR1EEsL9Nd2RhadO3QriWd53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";

const TODAY = new Date("2026-02-19");
const TODAY_STR = "2026-02-19";
const MKT = { Fixed:6.50, ARM:6.25, Bridge:10.50, IO:6.75, SOFR:6.40 };
const REFI_STAGES = ["Not Started","Exploring","LOI Received","Application Submitted","Appraisal Ordered","Commitment Issued","Closed"];
const ACT_TYPES = [{id:"call",icon:"📞",label:"Call"},{id:"email",icon:"✉️",label:"Email"},{id:"meeting",icon:"🤝",label:"Meeting"},{id:"document",icon:"📄",label:"Doc"},{id:"note",icon:"📝",label:"Note"}];

const mosBetween=(a,b)=>{const d1=new Date(a),d2=new Date(b);return(d2.getFullYear()-d1.getFullYear())*12+(d2.getMonth()-d1.getMonth());};
const calcPmt=(p,r,n)=>{const mr=r/100/12;if(!mr||n<=0)return 0;return p*(mr*Math.pow(1+mr,n))/(Math.pow(1+mr,n)-1);};
const calcBal=(p,r,n,t)=>{const mr=r/100/12;if(!mr)return Math.max(0,p-(p/n)*t);const pm=calcPmt(p,r,n);return Math.max(0,p*Math.pow(1+mr,t)-pm*((Math.pow(1+mr,t)-1)/mr));};
const daysTo=s=>{if(!s||s==="")return null;const d=new Date(s);if(isNaN(d))return null;return Math.round((d-TODAY)/86400000);};
const matSt=s=>{const d=daysTo(s);if(d===null)return"unknown";if(d<0)return"matured";if(d<=180)return"urgent";if(d<=365)return"soon";return"ok";};
const enrich=loan=>{
  const el=mosBetween(loan.origDate,TODAY_STR);
  const amM=(loan.amortYears||loan.termYears||1)*12;
  const cb=loan.interestOnly?loan.origBalance:Math.max(0,calcBal(loan.origBalance,loan.rate,amM,el));
  const pmt=loan.interestOnly?loan.origBalance*(loan.rate/100/12):calcPmt(loan.origBalance,loan.rate,amM);
  const mr=MKT[loan.loanType]||6.5;
  const mpmt=calcPmt(Math.max(0,cb),mr,Math.max(1,amM-el));
  const pp=loan.origBalance>0?Math.max(0,(loan.origBalance-cb)/loan.origBalance*100):0;
  const dl=daysTo(loan.maturityDate);
  const capExp=loan.capExpiry&&loan.loanType==="ARM"&&dl!=null&&daysTo(loan.capExpiry)<dl;
  const dscr=loan.annualNOI&&pmt>0?loan.annualNOI/(pmt*12):null;
  // Use actual currentBalance from DB if available, else calculated
  const actualBal=loan.currentBalance&&loan.currentBalance>0?loan.currentBalance:cb;
  return{...loan,curBal:actualBal,pmt,annualDS:pmt*12,marketPmt:mpmt,paidPct:pp,daysLeft:dl,status:matSt(loan.maturityDate),capExpiring:capExp,dscr};
};

const f$=n=>{if(!n&&n!==0)return"—";if(Math.abs(n)>=1e6)return`$${(n/1e6).toFixed(2)}M`;if(Math.abs(n)>=1e3)return`$${(n/1e3).toFixed(0)}K`;return`$${Math.round(n).toLocaleString()}`;};
const fPct=n=>n!=null&&n!==""?`${Number(n).toFixed(3)}%`:"—";
const fDate=s=>s?new Date(s).toLocaleDateString("en-US",{month:"long",year:"numeric"}):"—";
const fDateS=s=>s?new Date(s).toLocaleDateString("en-US",{month:"short",year:"numeric"}):"—";
const fDateF=s=>s?new Date(s).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}):"—";

const LOANS_INIT=[];


/* ─────────────────────────── CSS ────────────────────────────────────────── */
const CSS=`
@import url('https://fonts.googleapis.com/css2?family=Inter:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
html{height:100%;width:100%;}
body{height:100%;width:100%;background:var(--bg);color:var(--t1);font-family:var(--f);font-size:13px;-webkit-font-smoothing:antialiased;overflow:hidden;}
#root,#__next,[data-reactroot]{height:100%;width:100%;display:flex;flex-direction:column;}
:root{
  --bg:#f4f6f9;
  --white:#fff;
  --bd:#e5e7eb;
  --bd2:#d1d5db;
  --t1:#0f172a;
  --t2:#334155;
  --t3:#64748b;
  --t4:#94a3b8;
  --green:#16a34a;--gbg:#f0fdf4;--gbd:#bbf7d0;
  --red:#dc2626;--rbg:#fef2f2;--rbd:#fecaca;
  --amber:#d97706;--abg:#fffbeb;--abd:#fde68a;
  --blue:#2563eb;--bbg:#eff6ff;--bbd:#bfdbfe;
  --sb:#0f172a;
  --sb2:#1e293b;
  --sb3:#263045;
  --sb-bd:#ffffff0f;
  --sb-t1:#f1f5f9;
  --sb-t2:#94a3b8;
  --sb-t3:#475569;
  --sb-acc:#3b82f6;
  --f:'Inter',system-ui,sans-serif;
}
button{font-family:var(--f);cursor:pointer;}
input,select,textarea{font-family:var(--f);}
::-webkit-scrollbar{width:5px;height:5px;}
::-webkit-scrollbar-track{background:transparent;}
::-webkit-scrollbar-thumb{background:rgba(0,0,0,.15);border-radius:3px;}

/* SHELL */
.shell{display:flex;width:100%;height:100vh;min-height:100vh;overflow:hidden;position:fixed;top:0;left:0;right:0;bottom:0;}

/* ── SIDEBAR ── */
.sb{width:248px;flex-shrink:0;background:var(--sb);display:flex;flex-direction:column;overflow:hidden;box-shadow:2px 0 24px rgba(0,0,0,.18);}

/* Brand */
.sb-hd{padding:0;border-bottom:1px solid var(--sb-bd);}
.sb-brand{padding:24px 18px 20px;position:relative;overflow:hidden;background:linear-gradient(160deg,#0f172a 0%,#1a243c 60%,#0f172a 100%);}
.sb-brand::before{content:"";position:absolute;inset:0;background:radial-gradient(ellipse at 20% 60%,rgba(212,175,55,.07) 0%,transparent 65%),radial-gradient(ellipse at 80% 20%,rgba(212,175,55,.05) 0%,transparent 55%);pointer-events:none;}
.sb-brand::after{content:"";position:absolute;bottom:-1px;left:18px;right:18px;height:1px;background:linear-gradient(90deg,transparent,rgba(212,175,55,.3),transparent);}

.sb-monogram{width:44px;height:44px;flex-shrink:0;position:relative;margin-bottom:14px;}
.sb-monogram-bg{position:absolute;inset:0;background:linear-gradient(145deg,#c9a84c 0%,#f0d070 35%,#c9a84c 65%,#a8882a 100%);border-radius:12px;box-shadow:0 4px 16px rgba(212,175,55,.35),inset 0 1px 0 rgba(255,255,255,.25);}
.sb-monogram-letter{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:800;color:#0f172a;letter-spacing:-.02em;font-style:italic;}

.sb-wordmark{display:flex;flex-direction:column;gap:1px;position:relative;}
.sb-firm-name{font-size:17px;font-weight:700;color:#f8f4ea;letter-spacing:.01em;line-height:1.1;}
.sb-firm-name em{font-style:normal;color:#d4af37;}
.sb-firm-type{font-size:9px;font-weight:600;color:rgba(212,175,55,.7);letter-spacing:.2em;text-transform:uppercase;margin-top:4px;}
.sb-firm-rule{height:1px;background:linear-gradient(90deg,rgba(212,175,55,.4),transparent);margin-top:8px;width:100%;}
.sb-firm-meta{font-size:9px;color:rgba(148,163,184,.6);letter-spacing:.08em;margin-top:7px;font-weight:400;}

/* Search */
.sb-search{position:relative;}
.sb-search input{width:100%;padding:8px 11px 8px 32px;background:var(--sb2);border:1px solid var(--sb-bd);border-radius:9px;font-size:12px;color:var(--sb-t1);outline:none;transition:border-color .15s;}
.sb-search input::placeholder{color:var(--sb-t3);}
.sb-search input:focus{border-color:rgba(59,130,246,.5);background:var(--sb3);}
.sb-si{position:absolute;left:10px;top:50%;transform:translateY(-50%);font-size:12px;color:var(--sb-t3);pointer-events:none;}

/* Nav */
.sb-nav{flex:1;overflow-y:auto;padding:8px 10px 12px;}
.sb-nav::-webkit-scrollbar-thumb{background:rgba(255,255,255,.08);}
.sb-sec{padding:14px 8px 5px;font-size:9px;font-weight:700;color:var(--sb-t3);letter-spacing:.12em;text-transform:uppercase;}

.sb-row{display:flex;align-items:center;justify-content:space-between;padding:9px 10px;border-radius:9px;cursor:pointer;transition:background .12s;margin-bottom:1px;}
.sb-row:hover{background:var(--sb2);}
.sb-row.act{background:linear-gradient(90deg,rgba(59,130,246,.22),rgba(59,130,246,.08));border:1px solid rgba(59,130,246,.25);}
.sb-row.act .sb-rlbl{color:var(--sb-t1);font-weight:700;}
.sb-row.act .sb-ri{color:#60a5fa;}

.sb-rl{display:flex;align-items:center;gap:10px;}
.sb-ri{font-size:15px;width:18px;text-align:center;flex-shrink:0;color:var(--sb-t2);transition:color .12s;}
.sb-rtxt{}
.sb-rlbl{font-size:12px;font-weight:500;color:var(--sb-t2);transition:color .12s;}
.sb-row:hover .sb-rlbl{color:var(--sb-t1);}
.sb-row:hover .sb-ri{color:var(--sb-t1);}
.sb-rsub{font-size:10px;color:var(--sb-t3);margin-top:1px;}

.sb-badge{padding:2px 8px;border-radius:20px;font-size:10px;font-weight:700;min-width:20px;text-align:center;}
.bg-green{background:rgba(34,197,94,.15);color:#4ade80;}
.bg-red{background:rgba(239,68,68,.2);color:#f87171;}
.bg-amber{background:rgba(251,191,36,.15);color:#fbbf24;}
.bg-grey{background:rgba(255,255,255,.06);color:var(--sb-t3);}

.sb-div{height:1px;background:var(--sb-bd);margin:8px 10px;}

/* Grouped nav */
.sb-group{margin-bottom:2px;}
.sb-group-hd{display:flex;align-items:center;justify-content:space-between;padding:10px 10px 5px;cursor:pointer;user-select:none;border-radius:8px;transition:background .12s;}
.sb-group-hd:hover{background:var(--sb2);}
.sb-group-label{font-size:9px;font-weight:800;color:var(--sb-t3);letter-spacing:.14em;text-transform:uppercase;display:flex;align-items:center;gap:7px;}
.sb-group-icon{font-size:11px;opacity:.7;}
.sb-group-caret{font-size:9px;color:var(--sb-t3);transition:transform .2s;opacity:.6;}
.sb-group-caret.open{transform:rotate(90deg);}
.sb-group-items{overflow:hidden;transition:max-height .2s ease;}

/* Footer */
.sb-ft{padding:14px 16px;border-top:1px solid var(--sb-bd);}
.sb-user{display:flex;align-items:center;gap:10px;}
.sb-av{width:32px;height:32px;background:linear-gradient(135deg,#3b82f6,#8b5cf6);border-radius:50%;color:#fff;font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;}
.sb-uname{font-size:12px;font-weight:600;color:var(--sb-t1);}
.sb-urole{font-size:10px;color:var(--sb-t3);margin-top:1px;}
.sb-dot{width:7px;height:7px;border-radius:50%;background:#4ade80;border:1.5px solid var(--sb);margin-left:auto;flex-shrink:0;}

/* MAIN */
.main{flex:1;display:flex;flex-direction:column;overflow:hidden;background:var(--bg);}

/* TOPBAR */
.topbar{height:58px;background:var(--white);border-bottom:1px solid var(--bd);display:flex;align-items:center;justify-content:space-between;padding:0 28px;flex-shrink:0;box-shadow:0 1px 0 var(--bd);}
.tb-left{display:flex;align-items:center;gap:12px;}
.tb-back{width:28px;height:28px;background:var(--bg);border:1px solid var(--bd2);border-radius:8px;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:13px;color:var(--t3);transition:all .12s;}
.tb-back:hover{background:var(--bd);color:var(--t1);}
.tb-title{font-size:16px;font-weight:800;color:var(--t1);letter-spacing:-.02em;}
.tb-right{display:flex;gap:8px;align-items:center;}
.btn-dark{padding:8px 16px;background:var(--t1);color:#fff;border:none;border-radius:9px;font-size:12px;font-weight:600;display:flex;align-items:center;gap:6px;cursor:pointer;transition:all .15s;letter-spacing:.01em;}
.btn-dark:hover{background:#1e293b;transform:translateY(-1px);box-shadow:0 4px 12px rgba(15,23,42,.25);}
.btn-dark:active{transform:translateY(0);}
.btn-light{padding:8px 16px;background:var(--white);color:var(--t2);border:1px solid var(--bd2);border-radius:9px;font-size:12px;font-weight:500;cursor:pointer;display:flex;align-items:center;gap:6px;transition:all .12s;}
.btn-light:hover{background:var(--bg);border-color:var(--t4);}

/* CONTENT AREA */
.carea{flex:1;overflow-y:auto;padding:24px 28px;}

/* DETAIL TOP CARD */
.dtop{background:var(--white);border:1px solid var(--bd);border-radius:16px;padding:24px 28px;margin-bottom:14px;box-shadow:0 1px 4px rgba(0,0,0,.04);}
.d-addr{font-size:24px;font-weight:800;color:var(--t1);margin-bottom:3px;letter-spacing:-.02em;}
.d-ent{font-size:12px;color:var(--t3);margin-bottom:14px;}
.d-chips{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:20px;}
.chip{display:inline-flex;align-items:center;gap:5px;padding:4px 11px;border-radius:20px;font-size:11px;font-weight:600;white-space:nowrap;}
.chip-dot{width:5px;height:5px;border-radius:50%;}
.chip-green{background:var(--gbg);color:var(--green);border:1px solid var(--gbd);}
.chip-red{background:var(--rbg);color:var(--red);border:1px solid var(--rbd);}
.chip-amber{background:var(--abg);color:var(--amber);border:1px solid var(--abd);}
.chip-blue{background:var(--bbg);color:var(--blue);border:1px solid var(--bbd);}
.chip-grey{background:var(--bg);border:1px solid var(--bd2);color:var(--t3);}
.chip-dark{background:var(--t1);color:#fff;}
.d-meta-row{display:grid;grid-template-columns:repeat(4,1fr);gap:0;border-top:1px solid var(--bd);padding-top:18px;}
.dm{padding-right:20px;}
.dm-lbl{font-size:9px;font-weight:700;color:var(--t4);text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px;}
.dm-val{font-size:16px;font-weight:700;color:var(--t1);}
.dm-val.red{color:var(--red);}
.dm-val.green{color:var(--green);}
.dm-val.amber{color:var(--amber);}
.dm-val.muted{color:var(--t3);font-weight:400;}

/* DETAIL PANELS */
.dpanels{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-bottom:14px;}
.panel{background:var(--white);border:1px solid var(--bd);border-radius:14px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.03);}
.panel-hd{padding:11px 18px;border-bottom:1px solid var(--bd);font-size:9px;font-weight:700;color:var(--t3);text-transform:uppercase;letter-spacing:.1em;background:var(--bg);}
.panel-body{padding:14px 18px;}
.prow{display:flex;justify-content:space-between;align-items:baseline;padding:6px 0;border-bottom:1px solid var(--bd);}
.prow:last-child{border-bottom:none;}
.pk{font-size:11px;color:var(--t3);}
.pv{font-size:12px;font-weight:600;color:var(--t1);text-align:right;}
.pv.green{color:var(--green);}
.pv.red{color:var(--red);}
.pv.amber{color:var(--amber);}

/* HISTORY CARD */
.hist-card{background:var(--white);border:1px solid var(--bd);border-radius:14px;overflow:hidden;margin-bottom:14px;box-shadow:0 1px 3px rgba(0,0,0,.03);}
.hist-hd{display:flex;align-items:center;justify-content:space-between;padding:14px 20px;border-bottom:1px solid var(--bd);}
.hist-title{font-size:14px;font-weight:700;color:var(--t1);}
.hist-ct{font-size:11px;color:var(--t3);}
.hist-empty{padding:40px;text-align:center;}
.he-icon{font-size:26px;opacity:.15;margin-bottom:8px;}
.he-txt{font-size:12px;color:var(--t3);}
.act-entry{display:flex;gap:12px;padding:12px 20px;border-bottom:1px solid var(--bd);}
.act-entry:last-child{border-bottom:none;}
.ae-ic{width:28px;height:28px;border-radius:50%;background:var(--bg);border:1px solid var(--bd);display:flex;align-items:center;justify-content:center;font-size:12px;flex-shrink:0;}
.ae-txt{font-size:12px;color:var(--t2);line-height:1.5;margin-bottom:3px;}
.ae-meta{font-size:10px;color:var(--t4);display:flex;gap:8px;}

/* LOG FORM */
.log-form{padding:14px 20px;border-top:1px solid var(--bd);background:var(--bg);}
.lf-types{display:flex;gap:5px;margin-bottom:9px;}
.lf-tb{padding:4px 12px;background:var(--white);border:1px solid var(--bd);border-radius:20px;font-size:10px;color:var(--t3);cursor:pointer;transition:all .12s;}
.lf-tb:hover{border-color:var(--bd2);color:var(--t1);}
.lf-tb.sel{background:var(--t1);border-color:var(--t1);color:#fff;}
.lf-row{display:flex;gap:7px;}
.lf-inp{flex:1;padding:8px 12px;background:var(--white);border:1px solid var(--bd);border-radius:9px;color:var(--t1);font-size:12px;outline:none;transition:border-color .12s;}
.lf-inp:focus{border-color:var(--bd2);}
.lf-sub{padding:8px 16px;background:var(--t1);border:none;border-radius:9px;color:#fff;font-size:11px;font-weight:600;transition:all .12s;}
.lf-sub:hover{background:#1e293b;}

/* OVERVIEW / STAT CARDS */
.ov-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:20px;}
.scard{background:var(--white);border:1px solid var(--bd);border-radius:14px;padding:18px 20px;box-shadow:0 1px 3px rgba(0,0,0,.04);transition:box-shadow .15s;}
.scard:hover{box-shadow:0 4px 12px rgba(0,0,0,.07);}
.sc-lbl{font-size:9px;font-weight:700;color:var(--t4);text-transform:uppercase;letter-spacing:.08em;margin-bottom:9px;}
.sc-val{font-size:24px;font-weight:800;color:var(--t1);line-height:1;margin-bottom:5px;letter-spacing:-.02em;}
.sc-val.red{color:var(--red);}
.sc-val.green{color:var(--green);}
.sc-val.amber{color:var(--amber);}
.sc-val.blue{color:var(--blue);}
.sc-sub{font-size:11px;color:var(--t3);}

/* ALERTS */
.al-list{display:flex;flex-direction:column;gap:7px;margin-bottom:20px;}
.al-row{display:flex;gap:12px;align-items:flex-start;padding:12px 16px;border-radius:12px;border:1px solid;cursor:pointer;transition:transform .1s,box-shadow .1s;}
.al-row:hover{transform:translateX(2px);}
.al-red{background:var(--rbg);border-color:var(--rbd);}
.al-amber{background:var(--abg);border-color:var(--abd);}
.al-blue{background:var(--bbg);border-color:var(--bbd);}
.al-ic{font-size:14px;flex-shrink:0;margin-top:1px;}
.al-hl{font-size:12px;font-weight:700;color:var(--t1);}
.al-detail{font-size:11px;color:var(--t3);margin-top:2px;}
.al-action{font-size:10px;font-weight:700;margin-top:3px;text-transform:uppercase;letter-spacing:.04em;}
.al-red .al-action{color:var(--red);}
.al-amber .al-action{color:var(--amber);}
.al-blue .al-action{color:var(--blue);}

/* TABLE */
.tbl-wrap{background:var(--white);border:1px solid var(--bd);border-radius:14px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.04);}
.tbl{width:100%;border-collapse:collapse;}
.tbl th{text-align:left;padding:10px 16px;font-size:9px;font-weight:700;color:var(--t3);text-transform:uppercase;letter-spacing:.08em;background:var(--bg);border-bottom:1px solid var(--bd);cursor:pointer;white-space:nowrap;user-select:none;}
.tbl th:hover{color:var(--t1);}
.tbl td{padding:13px 16px;border-bottom:1px solid var(--bd);vertical-align:middle;}
.tbl tbody tr:last-child td{border-bottom:none;}
.tbl tbody tr{cursor:pointer;transition:background .1s;}
.tbl tbody tr:hover{background:#fafbfc;}
.td-a{font-size:13px;font-weight:700;color:var(--t1);}
.td-b{font-size:10px;color:var(--t3);margin-top:2px;}
.td-n{font-size:12px;font-weight:600;color:var(--t1);}
.td-n.green{color:var(--green);}
.td-n.red{color:var(--red);}
.td-n.amber{color:var(--amber);}
.td-n.muted{color:var(--t3);}

/* FILTER ROW */
.frow{display:flex;gap:6px;margin-bottom:16px;flex-wrap:wrap;align-items:center;}
.fb{padding:6px 14px;background:var(--white);border:1px solid var(--bd2);border-radius:20px;font-size:11px;font-weight:500;color:var(--t3);cursor:pointer;transition:all .12s;}
.fb:hover{border-color:var(--t4);color:var(--t1);}
.fb.fa{background:var(--t1);border-color:var(--t1);color:#fff;}
.fb.fred{background:var(--rbg);border-color:var(--rbd);color:var(--red);}
.fb.fgreen{background:var(--gbg);border-color:var(--gbd);color:var(--green);}
.f-inp{padding:6px 14px;background:var(--white);border:1px solid var(--bd2);border-radius:20px;font-size:11px;color:var(--t1);outline:none;min-width:200px;transition:border-color .12s;}
.f-inp:focus{border-color:var(--t4);}
.f-inp::placeholder{color:var(--t4);}
.f-ct{font-size:10px;color:var(--t3);margin-left:auto;}

/* REFI CALC */
.calc-layout{display:grid;grid-template-columns:310px 1fr;gap:16px;margin-bottom:24px;}
.cp{background:var(--white);border:1px solid var(--bd);border-radius:14px;padding:20px;box-shadow:0 1px 3px rgba(0,0,0,.04);}
.cp-t{font-size:14px;font-weight:700;color:var(--t1);margin-bottom:16px;}
.cp-l{font-size:9px;font-weight:700;color:var(--t3);text-transform:uppercase;letter-spacing:.07em;margin-bottom:5px;margin-top:13px;}
.cp-l:first-of-type{margin-top:0;}
.cp-i{width:100%;padding:9px 12px;background:var(--bg);border:1px solid var(--bd);border-radius:9px;color:var(--t1);font-size:13px;font-weight:500;outline:none;transition:border-color .15s;}
.cp-i:focus{border-color:var(--bd2);}
.cp-cur{background:var(--bg);border-radius:10px;padding:11px 14px;margin-top:12px;font-size:11px;color:var(--t2);line-height:1.8;border:1px solid var(--bd);}
.cp-cur strong{color:var(--t1);}
.cr-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;align-content:start;}
.crcard{background:var(--white);border:1px solid var(--bd);border-radius:13px;padding:18px 20px;box-shadow:0 1px 3px rgba(0,0,0,.04);}
.crcard.full{grid-column:span 2;}
.crcard.green{background:var(--gbg);border-color:var(--gbd);}
.crcard.red{background:var(--rbg);border-color:var(--rbd);}
.crc-l{font-size:9px;font-weight:700;color:var(--t3);text-transform:uppercase;letter-spacing:.08em;margin-bottom:9px;}
.crc-v{font-size:26px;font-weight:800;color:var(--t1);line-height:1;margin-bottom:4px;letter-spacing:-.02em;}
.crc-v.green{color:var(--green);}
.crc-v.red{color:var(--red);}
.crc-v.amber{color:var(--amber);}
.crc-s{font-size:11px;color:var(--t3);}
.pen-box{background:var(--rbg);border:1px solid var(--rbd);border-radius:13px;padding:16px 20px;margin-bottom:18px;}
.pen-l{font-size:9px;font-weight:700;color:var(--red);text-transform:uppercase;letter-spacing:.07em;margin-bottom:6px;}
.pen-v{font-size:28px;font-weight:800;color:var(--red);letter-spacing:-.02em;}
.pen-n{font-size:11px;color:var(--t3);margin-top:5px;}
.q-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:18px;}
.qcard{background:var(--white);border:1px solid var(--bd);border-radius:13px;padding:16px 18px;box-shadow:0 1px 3px rgba(0,0,0,.04);}
.qcard.best{border-color:var(--gbd);background:var(--gbg);}
.qc-hd{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;}
.qn-inp{background:transparent;border:none;font-size:13px;font-weight:700;color:var(--t1);width:100%;outline:none;}
.best-badge{font-size:9px;font-weight:700;color:#fff;background:var(--green);padding:3px 8px;border-radius:10px;}
.qrow{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;}
.qk{font-size:11px;color:var(--t3);}
.qv{font-size:12px;font-weight:600;color:var(--t1);}
.qv.green{color:var(--green);}
.qv.red{color:var(--red);}
.qi{background:transparent;border:none;font-size:12px;font-weight:600;color:var(--t1);text-align:right;width:65px;outline:none;}
.qdiv{height:1px;background:var(--bd);margin:9px 0;}

/* MISC */
.warn-box{padding:10px 14px;background:var(--rbg);border:1px solid var(--rbd);border-radius:10px;font-size:11px;color:var(--red);display:flex;gap:8px;align-items:center;margin-bottom:12px;font-weight:500;}
.sec-hdr{display:flex;align-items:baseline;justify-content:space-between;margin-bottom:14px;}
.sec-t{font-size:15px;font-weight:800;color:var(--t1);letter-spacing:-.01em;}
.sec-m{font-size:10px;color:var(--t3);font-weight:600;text-transform:uppercase;letter-spacing:.06em;}
.notes-ta{width:100%;background:var(--bg);border:1px solid var(--bd);border-radius:9px;padding:9px 12px;color:var(--t2);font-size:12px;resize:vertical;min-height:60px;outline:none;line-height:1.6;}
.notes-ta:focus{border-color:var(--bd2);}
.notes-ta::placeholder{color:var(--t4);}
.mfooter{display:flex;justify-content:flex-end;gap:8px;padding-top:14px;border-top:1px solid var(--bd);margin-top:14px;}
.copy-btn{background:transparent;border:none;padding:0 3px;color:var(--t4);font-size:10px;cursor:pointer;}
.copy-btn:hover{color:var(--green);}
.copy-btn.ok{color:var(--green);}
.refi-sel{padding:5px 10px;background:var(--bg);border:1px solid var(--bd);border-radius:8px;color:var(--t2);font-size:11px;outline:none;cursor:pointer;}

/* AMORT */
.amort-tbl{width:100%;border-collapse:collapse;font-size:11px;}
.amort-tbl th{text-align:right;padding:8px 12px;font-size:9px;font-weight:700;color:var(--t3);text-transform:uppercase;letter-spacing:.07em;border-bottom:1px solid var(--bd);background:var(--bg);}
.amort-tbl th:first-child{text-align:left;}
.amort-tbl td{text-align:right;padding:8px 12px;border-bottom:1px solid var(--bd);color:var(--t2);}
.amort-tbl td:first-child{text-align:left;color:var(--t3);}
.amort-tbl tr:hover td{background:var(--bg);}
.amort-tbl tr.yr-row td{background:var(--bg);font-weight:700;color:var(--t1);}
.amort-tbl tr.now-row td{background:var(--gbg);}
.show-more{width:100%;padding:9px;background:var(--bg);border:1px solid var(--bd);border-radius:9px;color:var(--t3);font-size:11px;cursor:pointer;margin-top:8px;transition:all .12s;}
.show-more:hover{background:var(--bd);color:var(--t1);}
.pd-bg{width:100%;height:5px;background:var(--bd);border-radius:3px;overflow:hidden;margin-top:6px;}
.pd-fill{height:5px;border-radius:3px;background:var(--green);}

/* MODAL */
.ov-modal{position:fixed;inset:0;background:rgba(15,23,42,.45);backdrop-filter:blur(4px);z-index:200;display:flex;align-items:center;justify-content:center;padding:20px;}
.ov-mbox{background:var(--white);border-radius:18px;width:100%;max-width:580px;box-shadow:0 24px 80px rgba(0,0,0,.2);overflow:hidden;max-height:90vh;display:flex;flex-direction:column;border:1px solid var(--bd);}
.ov-mhd{padding:18px 22px;border-bottom:1px solid var(--bd);display:flex;align-items:center;justify-content:space-between;flex-shrink:0;}
.ov-mtitle{font-size:16px;font-weight:800;color:var(--t1);letter-spacing:-.01em;}
.ov-mclose{width:28px;height:28px;background:var(--bg);border:1px solid var(--bd);border-radius:50%;font-size:13px;color:var(--t3);cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all .12s;}
.ov-mclose:hover{background:var(--bd);color:var(--t1);}
.ov-mbody{padding:18px 22px;overflow-y:auto;}
.fg{display:flex;flex-direction:column;gap:4px;margin-bottom:12px;}
.fg-2{display:grid;grid-template-columns:1fr 1fr;gap:12px;}
.flbl{font-size:9px;font-weight:700;color:var(--t3);text-transform:uppercase;letter-spacing:.08em;}
.finp{padding:9px 12px;background:var(--bg);border:1px solid var(--bd);border-radius:9px;color:var(--t1);font-size:12px;outline:none;width:100%;transition:border-color .12s;}
.finp:focus{border-color:var(--bd2);}
.finp::placeholder{color:var(--t4);}
.finp option{background:var(--white);}
.fsec{font-size:10px;font-weight:800;color:var(--t1);text-transform:uppercase;letter-spacing:.07em;margin:14px 0 8px;padding-bottom:6px;border-bottom:1px solid var(--bd);}
`;

/* ─────────── HELPERS ─────────── */
function CopyBtn({text}){
  const [ok,setOk]=useState(false);
  if(!text)return null;
  return <button className={`copy-btn${ok?" ok":""}`} onClick={e=>{e.stopPropagation();navigator.clipboard?.writeText(text).then(()=>{setOk(true);setTimeout(()=>setOk(false),1500);})}}>{ok?"✓":"⎘"}</button>;
}
function MatChip({loan}){
  const s=loan.status,d=loan.daysLeft;
  if(s==="unknown"||d===null||d===undefined) return <span className="chip chip-grey">No date</span>;
  const lbl=s==="matured"?"Past Maturity":d<=365?`${d}d left`:`${Math.round(d/30)}mo left`;
  const cls=s==="matured"||s==="urgent"?"chip-red":s==="soon"?"chip-amber":"chip-green";
  return <span className={`chip ${cls}`}>{lbl}</span>;
}
function RefiChip({status}){
  const s=status||"Not Started";
  const cls=s==="Closed"?"chip-green":s==="Not Started"?"chip-grey":["In Process","Application Submitted","Commitment Issued"].includes(s)?"chip-blue":"chip-amber";
  return <span className={`chip ${cls}`}>{s}</span>;
}

/* ─────────── AMORT ─────────── */
/* ─────────── CSV EXPORT UTIL ─────────── */
function downloadCSV(filename, headers, rows){
  const esc=v=>{const s=String(v??'');return s.includes(',')||s.includes('"')||s.includes('\n')?`"${s.replace(/"/g,'""')}"`:s;};
  const csv=[headers.map(esc).join(','),...rows.map(r=>r.map(esc).join(','))].join('\n');
  const a=document.createElement('a');
  a.href='data:text/csv;charset=utf-8,'+encodeURIComponent(csv);
  a.download=filename;a.click();
}

/* ─────────── AMORT SCHEDULE ─────────── */
function AmortSchedule({loan}){
  const [showAll,setShowAll]=useState(false);
  const amM=Math.max(1,(loan.amortYears||loan.termYears||1)*12);
  const termM=Math.max(1,(loan.termYears||1)*12);
  const mr=loan.rate/100/12;
  const pmt=loan.interestOnly?loan.origBalance*mr:calcPmt(loan.origBalance,loan.rate,amM);
  const elapsed=mosBetween(loan.origDate||TODAY_STR,TODAY_STR);

  // Build full schedule
  const allRows=[];
  let bal=loan.origBalance;
  let totalInt=0,totalPri=0;
  for(let m=1;m<=termM;m++){
    const interest=bal*mr;
    const principal=loan.interestOnly?0:Math.max(0,Math.min(pmt-interest,bal));
    const balloon=(m===termM&&!loan.interestOnly)?bal-principal:0;
    const closing=Math.max(0,bal-principal-balloon);
    totalInt+=interest;totalPri+=principal;
    const d=new Date(loan.origDate||TODAY_STR);d.setMonth(d.getMonth()+m);
    allRows.push({m,date:d.toISOString().slice(0,7),payment:interest+principal,interest,principal,balloon,balance:closing,totalInt,totalPri,isNow:m===elapsed});
    bal=closing;
    if(closing<=0)break;
  }

  const displayRows=showAll?allRows:allRows.filter(r=>r.isNow||r.m===1||r.m%12===0||r.m===allRows.length);

  const exportCSV=()=>downloadCSV(
    `amortization-${(loan.addr||'loan').replace(/\s+/g,'-')}.csv`,
    ['Month','Date','Payment','Interest','Principal','Balloon','Balance','Cumul. Interest','Cumul. Principal'],
    allRows.map(r=>[r.m,r.date,r.payment.toFixed(2),r.interest.toFixed(2),r.principal.toFixed(2),r.balloon.toFixed(2),r.balance.toFixed(2),r.totalInt.toFixed(2),r.totalPri.toFixed(2)])
  );

  const totalCost=totalInt+loan.origBalance;
  const lastRow=allRows[allRows.length-1];

  return(<div>
    {/* Summary stats */}
    <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:10,marginBottom:16}}>
      {[
        {l:'Monthly Payment',v:f$(pmt),c:''},
        {l:'Total Interest',v:f$(totalInt),c:'red'},
        {l:'Total Cost of Loan',v:f$(totalCost),c:''},
        {l:'Loan Paid Off',v:lastRow?.date?.slice(0,7)||'—',c:'green'},
      ].map((k,i)=>(
        <div key={i} style={{background:'var(--bg)',borderRadius:10,padding:'12px 14px',border:'1px solid var(--bd)'}}>
          <div style={{fontSize:9,fontWeight:700,color:'var(--t3)',textTransform:'uppercase',letterSpacing:'.06em',marginBottom:5}}>{k.l}</div>
          <div style={{fontSize:15,fontWeight:700,color:k.c==='red'?'var(--red)':k.c==='green'?'var(--green)':'var(--t1)'}}>{k.v}</div>
        </div>
      ))}
    </div>
    {/* Interest vs principal progress */}
    <div style={{marginBottom:14}}>
      <div style={{display:'flex',justifyContent:'space-between',fontSize:10,color:'var(--t3)',marginBottom:4}}>
        <span>Interest: {f$(totalInt)} ({(totalInt/totalCost*100).toFixed(0)}%)</span>
        <span>Principal: {f$(loan.origBalance)} ({(loan.origBalance/totalCost*100).toFixed(0)}%)</span>
      </div>
      <div style={{height:8,borderRadius:4,background:'var(--bd)',overflow:'hidden',display:'flex'}}>
        <div style={{width:`${totalInt/totalCost*100}%`,background:'#ef4444',opacity:.7}}/>
        <div style={{flex:1,background:'#22c55e',opacity:.7}}/>
      </div>
    </div>
    {/* Export + toggle */}
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
      <div style={{fontSize:11,color:'var(--t3)'}}>{showAll?allRows.length:displayRows.length} rows shown {!showAll?`(${allRows.length} total)`:''}</div>
      <div style={{display:'flex',gap:8}}>
        <button onClick={()=>setShowAll(s=>!s)} className="btn-light" style={{fontSize:11,padding:'5px 12px'}}>{showAll?'Show summary':'Show all months'}</button>
        <button onClick={exportCSV} className="btn-dark" style={{fontSize:11,padding:'5px 12px'}}>⬇ Export CSV</button>
      </div>
    </div>
    {/* Table */}
    <div style={{overflowX:'auto'}}>
      <table className="amort-tbl" style={{width:'100%'}}>
        <thead>
          <tr>
            <th>Mo</th><th>Date</th><th>Payment</th>
            <th style={{color:'var(--red)'}}>Interest</th>
            <th style={{color:'var(--green)'}}>Principal</th>
            <th>Balance</th>
            <th style={{color:'var(--t4)'}}>Cumul. Interest</th>
          </tr>
        </thead>
        <tbody>
          {displayRows.map(r=>(
            <tr key={r.m} style={{background:r.isNow?'#fff8e1':r.m%24===0?'var(--bg)':'var(--white)',fontWeight:r.isNow?700:400}}>
              <td style={{color:r.isNow?'var(--amber)':'var(--t2)',fontSize:11}}>{r.isNow?'▶ Now':r.m}</td>
              <td style={{fontSize:11,color:'var(--t3)'}}>{r.date}</td>
              <td style={{fontWeight:600}}>{f$(r.payment)}</td>
              <td style={{color:'var(--red)'}}>{f$(r.interest)}</td>
              <td style={{color:'var(--green)'}}>{f$(r.principal)}</td>
              <td style={{fontWeight:600}}>{f$(r.balance)}</td>
              <td style={{color:'var(--t4)',fontSize:11}}>{f$(r.totalInt)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr style={{background:'var(--bg)',fontWeight:700}}>
            <td colSpan={3} style={{fontSize:11}}>TOTALS</td>
            <td style={{color:'var(--red)'}}>{f$(totalInt)}</td>
            <td style={{color:'var(--green)'}}>{f$(totalPri)}</td>
            <td></td><td></td>
          </tr>
        </tfoot>
      </table>
    </div>
  </div>);
}


/* ─────────── ACTIVITY LOG ─────────── */
function ActivityLog({log,onAdd,onDel}){
  const [txt,setTxt]=useState(""),[type,setType]=useState("call");
  const sub=()=>{if(!txt.trim())return;onAdd({id:Date.now(),type,text:txt.trim(),date:TODAY_STR});setTxt("");};
  return(<div>
    {log.length===0&&<div className="hist-empty"><div className="he-icon">📋</div><div className="he-txt">No records yet — log the first activity above</div></div>}
    {[...log].reverse().map(e=>{const at=ACT_TYPES.find(a=>a.id===e.type)||ACT_TYPES[4];return(
      <div key={e.id} className="act-entry">
        <div className="ae-ic">{at.icon}</div>
        <div style={{flex:1}}>
          <div className="ae-txt">{e.text}</div>
          <div className="ae-meta"><span>{at.label}</span><span>{fDateF(e.date)}</span>
            <button style={{background:"none",border:"none",color:"var(--t4)",cursor:"pointer",fontSize:9,padding:0}} onClick={()=>onDel(e.id)}>✕</button>
          </div>
        </div>
      </div>
    );})}
    <div className="log-form">
      <div className="lf-types">{ACT_TYPES.map(a=><button key={a.id} className={`lf-tb${type===a.id?" sel":""}`} onClick={()=>setType(a.id)}>{a.icon} {a.label}</button>)}</div>
      <div className="lf-row">
        <input className="lf-inp" placeholder="Log a call, note, or meeting…" value={txt} onChange={e=>setTxt(e.target.value)} onKeyDown={e=>e.key==="Enter"&&sub()}/>
        <button className="lf-sub" onClick={sub}>Add</button>
      </div>
    </div>
  </div>);
}

/* ─────────── PREPAYMENT / EXIT COST CALCULATOR ─────────── */
const TREASURY_RATE=4.35; // approximate 10yr Treasury — update as needed

function PrepayCalc({loan}){
  const el=enrich(loan);
  const bal=el.curBal;
  const moLeft=el.daysLeft!=null?Math.max(0,el.daysLeft/30):0;
  const prepayRaw=(loan.prepay||"").toLowerCase();

  // Detect prepay type from field
  const isYM=prepayRaw.includes("yield")||prepayRaw.includes("ym");
  const isDefeas=prepayRaw.includes("defeas");
  const isStepdown=!!prepayRaw.match(/\d[\-–]\d/);
  const isFixedPct=!!prepayRaw.match(/^\d+(\.\d+)?%/);
  const isMakeWhole=prepayRaw.includes("make whole")||prepayRaw.includes("makewhole");
  const isNone=prepayRaw==="none"||prepayRaw===""||prepayRaw==="n/a";

  // Yield Maintenance calc
  const [mktRate,setMktRate]=useState(String(TREASURY_RATE));
  const loanRate=loan.rate/100/12;
  const treasuryRate=parseFloat(mktRate)/100/12;
  const ymMonths=Math.round(moLeft);
  const ymPV=ymMonths>0?Array.from({length:ymMonths},(_,i)=>bal*Math.max(0,loanRate-treasuryRate)/Math.pow(1+treasuryRate,i+1)).reduce((a,b)=>a+b,0):0;
  const ymTotal=Math.max(0,ymPV);

  // Defeasance estimate (Treasury bond portfolio)
  const defeasRate=parseFloat(mktRate)/100;
  const defeasCost=ymMonths>0?Math.max(0,bal-(bal/(Math.pow(1+defeasRate/12,ymMonths)))*ymMonths*defeasRate/12):0;
  const defeasAlt=bal*0.03; // rough 3% rule of thumb

  // Step-down parse (e.g. "5-4-3-2-1" = 5% yr1, 4% yr2, etc.)
  const parseStepdown=()=>{
    const nums=prepayRaw.match(/\d+/g);
    if(!nums)return null;
    const steps=nums.map(Number);
    const yearsElapsed=Math.floor(mosBetween(loan.origDate||TODAY_STR,TODAY_STR)/12);
    const pct=(steps[yearsElapsed]||0)/100;
    return{pct,cost:bal*pct,yearsElapsed,steps};
  };
  const stepInfo=isStepdown?parseStepdown():null;

  // Fixed % parse
  const fixedPct=isFixedPct?parseFloat(prepayRaw)/100:null;

  // Make-whole (similar to YM but uses full term)
  const makeWholeCost=isMakeWhole?ymTotal*1.15:null; // ~15% premium over YM estimate

  // User-entered scenario
  const [scenPct,setScenPct]=useState("1.0");
  const scenCost=bal*(parseFloat(scenPct)||0)/100;

  const Row=({label,val,note,highlight})=>(
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",padding:"12px 0",borderBottom:"1px solid var(--bd)"}}>
      <div>
        <div style={{fontSize:13,fontWeight:600,color:"var(--t1)"}}>{label}</div>
        {note&&<div style={{fontSize:10,color:"var(--t3)",marginTop:2,maxWidth:380,lineHeight:1.5}}>{note}</div>}
      </div>
      <div style={{fontSize:18,fontWeight:700,color:highlight?"var(--red)":"var(--t1)",flexShrink:0,marginLeft:24,textAlign:"right"}}>
        {val}
        <div style={{fontSize:10,color:"var(--t3)",fontWeight:400,textAlign:"right"}}>
          {typeof val==="string"&&val.startsWith("$")?`${((parseFloat(val.replace(/[$MK,]/g,""))*1e6>bal?1:parseFloat(val.replace(/[$,MK]/g,""))*1000/bal)*100).toFixed(1)}% of balance`:""}
        </div>
      </div>
    </div>
  );

  return(<div>
    {/* Header context */}
    <div style={{background:"var(--bg)",border:"1px solid var(--bd)",borderRadius:12,padding:"14px 18px",marginBottom:20,display:"flex",gap:32,flexWrap:"wrap"}}>
      <div><div style={{fontSize:9,fontWeight:700,color:"var(--t3)",textTransform:"uppercase",letterSpacing:".07em",marginBottom:3}}>Current Balance</div><div style={{fontSize:18,fontWeight:700,color:"var(--t1)"}}>{f$(bal)}</div></div>
      <div><div style={{fontSize:9,fontWeight:700,color:"var(--t3)",textTransform:"uppercase",letterSpacing:".07em",marginBottom:3}}>Rate</div><div style={{fontSize:18,fontWeight:700,color:"var(--t1)"}}>{fPct(loan.rate)}</div></div>
      <div><div style={{fontSize:9,fontWeight:700,color:"var(--t3)",textTransform:"uppercase",letterSpacing:".07em",marginBottom:3}}>Months Remaining</div><div style={{fontSize:18,fontWeight:700,color:"var(--t1)"}}>{Math.round(moLeft)}</div></div>
      <div><div style={{fontSize:9,fontWeight:700,color:"var(--t3)",textTransform:"uppercase",letterSpacing:".07em",marginBottom:3}}>Stated Prepay Terms</div><div style={{fontSize:18,fontWeight:700,color:"var(--amber)"}}>{loan.prepay||"Not specified"}</div></div>
    </div>

    {/* Treasury rate input */}
    <div style={{background:"var(--white)",border:"1px solid var(--bd)",borderRadius:12,padding:"14px 18px",marginBottom:20,display:"flex",alignItems:"center",gap:16}}>
      <div style={{flex:1}}>
        <div style={{fontSize:12,fontWeight:600,color:"var(--t1)",marginBottom:2}}>10-Year Treasury Rate (%)</div>
        <div style={{fontSize:11,color:"var(--t3)"}}>Used for Yield Maintenance and Defeasance calculations. Update to current rate before making decisions.</div>
      </div>
      <input type="number" step="0.01" value={mktRate} onChange={e=>setMktRate(e.target.value)}
        style={{width:100,padding:"8px 12px",border:"2px solid var(--blue)",borderRadius:9,fontSize:16,fontWeight:700,color:"var(--blue)",textAlign:"center",outline:"none"}}/>
    </div>

    {/* Results */}
    <div style={{background:"var(--white)",border:"1px solid var(--bd)",borderRadius:14,padding:"6px 20px 0",marginBottom:20}}>
      <div style={{fontSize:10,fontWeight:700,color:"var(--t3)",textTransform:"uppercase",letterSpacing:".08em",padding:"12px 0 4px"}}>Exit Cost Scenarios</div>

      {(isYM||isMakeWhole)&&<Row
        label={isMakeWhole?"Make-Whole Premium (est.)":"Yield Maintenance (est.)"}
        val={f$(isMakeWhole?makeWholeCost:ymTotal)}
        note={`Spread: ${fPct(loan.rate)} loan − ${mktRate}% Treasury = ${fPct(Math.max(0,loan.rate-parseFloat(mktRate)))} over ${Math.round(moLeft)} months, discounted at Treasury rate. Get exact figure from ${loan.servicerName||"your servicer"} before acting.`}
        highlight={ymTotal>50000}
      />}

      {isDefeas&&<Row
        label="Defeasance Cost (est.)"
        val={f$(defeasAlt)}
        note={`Rough estimate ~3% of balance. True defeasance requires purchasing a Treasury bond portfolio sized to cover remaining payments. Get exact quote from Chatham Financial or Thirty Capital.`}
        highlight={defeasAlt>50000}
      />}

      {isStepdown&&stepInfo&&<Row
        label={`Step-Down Penalty — Year ${stepInfo.yearsElapsed+1}`}
        val={f$(stepInfo.cost)}
        note={`Schedule: ${stepInfo.steps.join("% → ")}% — you are in year ${stepInfo.yearsElapsed+1}, penalty is ${stepInfo.steps[stepInfo.yearsElapsed]||0}% of outstanding balance.`}
        highlight={stepInfo.cost>25000}
      />}

      {isFixedPct&&<Row
        label={`Fixed Prepayment Penalty (${prepayRaw})`}
        val={f$(bal*(fixedPct||0))}
        note={`${prepayRaw} of current outstanding balance of ${f$(bal)}.`}
        highlight
      />}

      {isNone&&<div style={{padding:"20px 0",textAlign:"center"}}>
        <div style={{fontSize:24,marginBottom:8}}>✅</div>
        <div style={{fontSize:14,fontWeight:600,color:"var(--green)"}}>No prepayment penalty recorded</div>
        <div style={{fontSize:11,color:"var(--t3)",marginTop:4}}>Confirm with your servicer before proceeding.</div>
      </div>}

      {!isYM&&!isDefeas&&!isStepdown&&!isFixedPct&&!isMakeWhole&&!isNone&&<div style={{padding:"16px 0",color:"var(--t3)",fontSize:12}}>
        Prepay terms "{loan.prepay}" not auto-recognized. Use the custom scenario below.
      </div>}

      {/* Always show custom scenario */}
      <div style={{borderTop:"1px solid var(--bd)",padding:"14px 0"}}>
        <div style={{fontSize:12,fontWeight:600,color:"var(--t2)",marginBottom:8}}>Custom Scenario — Enter penalty % of balance</div>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <input type="number" step="0.1" value={scenPct} onChange={e=>setScenPct(e.target.value)}
            style={{width:80,padding:"6px 10px",border:"1px solid var(--bd2)",borderRadius:8,fontSize:13,fontWeight:600,outline:"none"}}/>
          <span style={{fontSize:12,color:"var(--t3)"}}>% of {f$(bal)}</span>
          <span style={{fontSize:18,fontWeight:700,color:"var(--red)",marginLeft:"auto"}}>{f$(scenCost)}</span>
        </div>
      </div>
    </div>

    {/* Total exit cost breakdown */}
    <div style={{background:"var(--rbg)",border:"1px solid var(--rbd)",borderRadius:14,padding:"16px 20px"}}>
      <div style={{fontSize:12,fontWeight:700,color:"var(--t1)",marginBottom:12}}>⚠ Remember: Total Exit Cost = Prepay Penalty + Closing Costs + Legal/Title</div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10}}>
        {[
          {l:"Prepay Penalty",v:isStepdown&&stepInfo?f$(stepInfo.cost):isYM?f$(ymTotal):isDefeas?f$(defeasAlt):"See above"},
          {l:"Closing Costs (est. 1%)",v:f$(bal*0.01)},
          {l:"Legal / Title (est.)",v:f$(Math.min(50000,bal*0.003))},
        ].map((it,i)=>(
          <div key={i} style={{background:"var(--white)",borderRadius:10,padding:"10px 14px"}}>
            <div style={{fontSize:9,fontWeight:700,color:"var(--t3)",textTransform:"uppercase",letterSpacing:".06em",marginBottom:4}}>{it.l}</div>
            <div style={{fontSize:15,fontWeight:700,color:"var(--red)"}}>{it.v}</div>
          </div>
        ))}
      </div>
    </div>
  </div>);
}


function LoanDetail({raw,onBack,onSave,onEdit,onDelete}){
  const loan=enrich(raw);
  const [tab,setTab]=useState("overview");
  const [rs,setRs]=useState(raw.refiStatus||"Not Started");
  const [confirmDelete,setConfirmDelete]=useState(false);
  const dscrAlert=loan.dscr&&raw.dscrCovenant&&loan.dscr<raw.dscrCovenant;
  const mktSave=Math.max(0,loan.pmt-loan.marketPmt);

  return(<div className="detail-wrap">
    <div className="dtop">
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:12}}>
        <div><div className="d-addr">{loan.addr}</div><div className="d-ent">{loan.entity||loan.lender}</div></div>
        <div style={{display:"flex",gap:8,flexShrink:0,flexWrap:"wrap"}}>
          <button onClick={onEdit} style={{padding:"6px 14px",background:"var(--white)",border:"1px solid var(--bd2)",borderRadius:8,fontSize:12,fontWeight:600,color:"var(--t2)",cursor:"pointer"}}>✏️ Edit</button>
          {confirmDelete
            ?<div style={{display:"flex",gap:6,alignItems:"center"}}>
              <span style={{fontSize:11,color:"var(--red)",fontWeight:700}}>Delete this loan?</span>
              <button onClick={onDelete} style={{padding:"6px 12px",background:"var(--red)",border:"none",borderRadius:8,fontSize:11,fontWeight:700,color:"#fff",cursor:"pointer"}}>Confirm</button>
              <button onClick={()=>setConfirmDelete(false)} style={{padding:"6px 10px",background:"var(--white)",border:"1px solid var(--bd)",borderRadius:8,fontSize:11,color:"var(--t3)",cursor:"pointer"}}>Cancel</button>
            </div>
            :<button onClick={()=>setConfirmDelete(true)} style={{padding:"6px 14px",background:"var(--rbg)",border:"1px solid var(--rbd)",borderRadius:8,fontSize:12,fontWeight:600,color:"var(--red)",cursor:"pointer"}}>🗑 Delete</button>
          }
        </div>
      </div>
      <div className="d-chips" style={{marginTop:10}}>
        <MatChip loan={loan}/>
        <span className={`chip ${loan.loanType==="Bridge"?"chip-dark":loan.loanType==="ARM"?"chip-amber":"chip-grey"}`}>{loan.loanType}</span>
        <span className="chip chip-grey">{loan.lenderType}</span>
        <span className="chip chip-grey">{loan.interestOnly?"Interest Only":`${loan.amortYears}yr amort`}</span>
        <RefiChip status={rs}/>
      </div>
      <div className="d-meta-row">
        <div className="dm"><div className="dm-lbl">Maturity</div><div className={`dm-val${loan.status==="urgent"||loan.status==="matured"?" red":loan.status==="soon"?" amber":""}`}>{fDate(loan.maturityDate)}</div></div>
        <div className="dm"><div className="dm-lbl">Current Balance</div><div className="dm-val">{f$(loan.curBal)}</div></div>
        <div className="dm"><div className="dm-lbl">Monthly Payment</div><div className="dm-val">{f$(loan.pmt)}</div></div>
        <div className="dm"><div className="dm-lbl">Annual DS</div><div className="dm-val">{f$(loan.annualDS)}</div></div>
      </div>
    </div>

    <div style={{display:"flex",gap:2,marginBottom:12,background:"var(--white)",borderRadius:10,padding:3,border:"1px solid var(--bd)",width:"fit-content",flexWrap:"wrap"}}>
      {[["overview","Overview"],["amort","📊 Amortization"],["prepay","💰 Prepayment"],["activity",`📋 Activity (${raw.activityLog?.length||0})`],["contacts","Contacts"]].map(([id,lbl])=>(
        <button key={id} onClick={()=>setTab(id)} style={{padding:"6px 14px",borderRadius:8,border:"none",fontSize:12,fontWeight:tab===id?700:400,background:tab===id?"var(--t1)":"transparent",color:tab===id?"var(--white)":"var(--t3)",cursor:"pointer"}}>{lbl}</button>
      ))}
    </div>

    {tab==="overview"&&<>
      {dscrAlert&&<div className="warn-box">⚠ DSCR {loan.dscr?.toFixed(2)}x below covenant ({raw.dscrCovenant}x)</div>}
      {loan.capExpiring&&<div className="warn-box">⚠ Rate cap expires {fDateS(loan.capExpiry)} before loan maturity</div>}
      <div className="dpanels">
        <div className="panel"><div className="panel-hd">Loan Terms</div><div className="panel-body">
          <div className="prow"><span className="pk">Lender</span><span className="pv">{loan.lender}</span></div>
          <div className="prow"><span className="pk">Rate</span><span className={`pv${loan.rate>7?" red":loan.rate>5?" amber":" green"}`}>{fPct(loan.rate)}</span></div>
          <div className="prow"><span className="pk">Orig. Balance</span><span className="pv">{f$(loan.origBalance)}</span></div>
          <div className="prow"><span className="pk">Monthly Pmt</span><span className="pv">{f$(loan.pmt)}</span></div>
          <div className="prow"><span className="pk">Annual DS</span><span className="pv">{f$(loan.annualDS)}</span></div>
          <div className="prow"><span className="pk">Prepay</span><span className="pv" style={{color:"var(--amber)",fontWeight:600}}>{loan.prepay||"None"}</span></div>
          <div className="prow"><span className="pk">Extension</span><span className="pv">{loan.extensionOptions||"None"}</span></div>
          {!loan.interestOnly&&<><div className="pk" style={{marginTop:8,fontSize:9,fontWeight:700,letterSpacing:".06em",textTransform:"uppercase",color:"var(--t4)"}}>Principal Paid — {loan.paidPct.toFixed(1)}%</div><div className="pd-bg"><div className="pd-fill" style={{width:`${Math.min(100,loan.paidPct)}%`}}/></div></>}
        </div></div>
        <div className="panel"><div className="panel-hd">Compliance & Risk</div><div className="panel-body">
          <div className="prow"><span className="pk">Recourse</span><span className="pv">{loan.recourse?"Yes":"Non-Recourse"}</span></div>
          <div className="prow"><span className="pk">Guarantor</span><span className="pv">{loan.guarantor||"—"}</span></div>
          <div className="prow"><span className="pk">DSCR</span><span className={`pv${dscrAlert?" red":loan.dscr&&loan.dscr>1.3?" green":" amber"}`}>{loan.dscr?loan.dscr.toFixed(2)+"x":"—"}</span></div>
          <div className="prow"><span className="pk">DSCR Covenant</span><span className="pv">{raw.dscrCovenant?raw.dscrCovenant+"x":"—"}</span></div>
          <div className="prow"><span className="pk">Escrow</span><span className="pv">{loan.escrow||"None"}</span></div>
          <div className="prow"><span className="pk">Market Rate</span><span className="pv">{fPct(MKT[loan.loanType])}</span></div>
          <div className="prow"><span className="pk">Originated</span><span className="pv">{fDateS(loan.origDate)}</span></div>
        </div></div>
        <div className="panel"><div className="panel-hd">Service Vendor</div><div className="panel-body">
          <div className="prow"><span className="pk">Company</span><span className="pv">{raw.servicerName||"—"}</span></div>
          <div className="prow"><span className="pk">Phone</span><span className="pv" style={{display:"flex",alignItems:"center",gap:3}}>{raw.servicerPhone||"—"}<CopyBtn text={raw.servicerPhone}/></span></div>
          <div className="prow"><span className="pk">Email</span><span className="pv" style={{display:"flex",alignItems:"center",gap:3,fontSize:10}}>{raw.servicerEmail||"—"}<CopyBtn text={raw.servicerEmail}/></span></div>
          <div className="prow"><span className="pk">Broker</span><span className="pv">{raw.brokerName||"—"}</span></div>
          <div className="prow"><span className="pk">Broker Phone</span><span className="pv" style={{display:"flex",alignItems:"center",gap:3}}>{raw.brokerPhone||"—"}<CopyBtn text={raw.brokerPhone}/></span></div>
          <div className="prow"><span className="pk">Refi Status</span><span className="pv"><select className="refi-sel" value={rs} onChange={e=>{setRs(e.target.value);onSave(raw.id,{refiStatus:e.target.value});}}>{REFI_STAGES.map(s=><option key={s}>{s}</option>)}</select></span></div>
        </div></div>
      </div>
      {mktSave>0&&<div style={{background:"var(--gbg)",border:"1px solid var(--gbd)",borderRadius:12,padding:"13px 18px",marginBottom:12,display:"flex",alignItems:"center",gap:16}}>
        <div style={{fontSize:22,fontWeight:700,color:"var(--green)"}}>{f$(mktSave*12)}/yr</div>
        <div><div style={{fontSize:12,fontWeight:600,color:"var(--t1)"}}>Potential savings vs. today's market rate</div><div style={{fontSize:11,color:"var(--t3)"}}>{f$(mktSave)}/mo if refinanced at {fPct(MKT[loan.loanType])}</div></div>
      </div>}
      {raw.notes&&<div style={{background:"var(--white)",border:"1px solid var(--bd)",borderRadius:12,padding:"14px 18px",marginBottom:12}}>
        <div style={{fontSize:9,fontWeight:700,color:"var(--t3)",textTransform:"uppercase",letterSpacing:".07em",marginBottom:6}}>Notes</div>
        <div style={{fontSize:12,color:"var(--t2)",lineHeight:1.7,whiteSpace:"pre-wrap"}}>{raw.notes}</div>
      </div>}
    </>}

    {tab==="amort"&&<div style={{background:"var(--white)",border:"1px solid var(--bd)",borderRadius:14,padding:20}}><AmortSchedule loan={raw}/></div>}
    {tab==="prepay"&&<div style={{background:"var(--white)",border:"1px solid var(--bd)",borderRadius:14,padding:20}}><PrepayCalc loan={raw}/></div>}
    {tab==="activity"&&<div className="hist-card">
      <div className="hist-hd"><div className="hist-title">Activity History</div><div className="hist-ct">{raw.activityLog?.length||0} records</div></div>
      <ActivityLog log={raw.activityLog||[]} onAdd={e=>onSave(raw.id,{actAdd:e})} onDel={id=>onSave(raw.id,{actDel:id})}/>
    </div>}
    {tab==="contacts"&&<div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
      {[{role:"Servicer",name:raw.servicerName,phone:raw.servicerPhone,email:raw.servicerEmail},{role:"Broker / Arranger",name:raw.brokerName,phone:raw.brokerPhone}].map((c,i)=>(
        <div key={i} style={{background:"var(--white)",border:"1px solid var(--bd)",borderRadius:14,padding:"16px 18px"}}>
          <div style={{fontSize:9,fontWeight:700,color:"var(--t3)",textTransform:"uppercase",letterSpacing:".07em",marginBottom:8}}>{c.role}</div>
          <div style={{fontSize:14,fontWeight:700,color:"var(--t1)",marginBottom:6}}>{c.name||"—"}</div>
          {c.phone&&<div style={{fontSize:11,color:"var(--t3)",display:"flex",alignItems:"center",gap:4,marginBottom:3}}>{c.phone}<CopyBtn text={c.phone}/></div>}
          {c.email&&<div style={{fontSize:11,color:"var(--t3)",display:"flex",alignItems:"center",gap:4}}>{c.email}<CopyBtn text={c.email}/></div>}
        </div>
      ))}
    </div>}
  </div>);
}

/* ─────────── REFI CALCULATOR ─────────── */
function RefiCalc({loans}){
  const en=useMemo(()=>loans.map(enrich),[loans]);
  const [selId,setSelId]=useState(String(loans[0]?.id||""));
  const sel=en.find(l=>String(l.id)===selId);
  const cb=sel?.curBal||0, origBal=sel?.origBalance||0, cp=sel?.pmt||0;
  const annualDS=cp*12;

  // Lender quotes — blank by default
  const blankQ=()=>({name:"",rate:"",amort:"",term:"",costs:"",notes:""});
  const [quotes,setQuotes]=useState([blankQ(),blankQ(),blankQ()]);
  const setQ=(i,k,v)=>setQuotes(q=>q.map((x,j)=>j===i?{...x,[k]:v}:x));

  const qcalc=quotes.map(q=>{
    const r=parseFloat(q.rate)||0;
    const a=parseInt(q.amort)*12||360;
    const pmt=r>0&&a>0?calcPmt(cb,r,a):null;
    const costAmt=cb*(parseFloat(q.costs)||0)/100;
    const diff=pmt!=null?cp-pmt:null;
    const be=diff&&diff>0&&costAmt>0?Math.ceil(costAmt/diff):null;
    const net10=diff!=null?diff*120-costAmt:null;
    const annNew=pmt!=null?pmt*12:null;
    return{...q,pmt,costAmt,diff,be,net10,annNew};
  });

  const filledQuotes=qcalc.filter(q=>q.pmt!=null);
  const bi=filledQuotes.length>0?qcalc.reduce((b,q,i)=>q.pmt!=null&&(qcalc[b].pmt==null||q.pmt<qcalc[b].pmt)?i:b,0):null;

  const ymEst=sel?.prepay&&sel.prepay.toLowerCase().includes("yield")&&sel.daysLeft!=null?cb*(Math.max(0,(sel.rate-(parseFloat(filledQuotes[0]?.rate)||sel.rate)))/100)*(Math.max(0,sel.daysLeft)/365)*0.7:null;

  const CARD={background:"var(--white)",border:"1px solid var(--bd)",borderRadius:12,padding:"16px 20px"};
  const ROW={display:"flex",justifyContent:"space-between",alignItems:"center",padding:"7px 0",borderBottom:"1px solid var(--bd2)"};
  const LBL={fontSize:12,color:"var(--t3)"};
  const VAL={fontSize:13,fontWeight:700,color:"var(--t1)"};

  return(<div>
    <div style={{marginBottom:20}}>
      <div style={{fontSize:22,fontWeight:700,color:"var(--t1)",marginBottom:4}}>Refinancing Calculator</div>
      <div style={{fontSize:13,color:"var(--t3)"}}>Select a property, review its current loan, then enter lender quotes to compare.</div>
    </div>

    {/* Loan selector */}
    <div style={{...CARD,marginBottom:20}}>
      <div style={{fontSize:11,fontWeight:700,color:"var(--t3)",textTransform:"uppercase",letterSpacing:".07em",marginBottom:8}}>Select Property</div>
      <select style={{width:"100%",padding:"9px 12px",borderRadius:8,border:"1px solid var(--bd)",background:"var(--bg)",color:"var(--t1)",fontSize:13,fontWeight:600}}
        value={selId} onChange={e=>setSelId(e.target.value)}>
        {loans.map(l=><option key={l.id} value={String(l.id)}>{l.addr} — {l.lender}</option>)}
      </select>
    </div>

    {sel&&<>
    {/* ── CURRENT LOAN DETAILS ── */}
    <div style={{fontSize:13,fontWeight:700,color:"var(--t1)",marginBottom:10,textTransform:"uppercase",letterSpacing:".05em"}}>📋 Current Loan — {sel.addr}</div>
    <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12,marginBottom:24}}>
      {[
        ["Original Loan Amount",  f$(origBal),       ""],
        ["Current Balance",       f$(cb),             "estimated"],
        ["Interest Rate",         fPct(sel.rate),     sel.loanType||""],
        ["Monthly Payment",       f$(cp),             "per month"],
        ["Annual Debt Service",   f$(annualDS),       "per year"],
        ["Maturity Date",         fDateS(sel.maturityDate)||"—", sel.daysLeft!=null?`${sel.daysLeft} days left`:""],
        ["Close Date",            sel.origDate?new Date(sel.origDate).toLocaleDateString("en-US",{month:"short",year:"numeric"}):"—", ""],
        ["Term",                  sel.termMonths?`${sel.termMonths} months`:(sel.termYears?`${sel.termYears} years`:"—"), ""],
        ["Prepay Penalty",        sel.prepay||"None", "PPP"],
        ["IO Period",             sel.ioPeriodMonths?`${sel.ioPeriodMonths} months`:"N/A", ""],
        ["Lender",                sel.lender,         "current lender"],
        ["Refi Status",           sel.refiStatus||"Not Started", ""],
      ].map(([lbl,val,sub],i)=>(
        <div key={i} style={{...CARD,padding:"14px 16px"}}>
          <div style={{fontSize:9,fontWeight:700,color:"var(--t3)",textTransform:"uppercase",letterSpacing:".08em",marginBottom:6}}>{lbl}</div>
          <div style={{fontSize:18,fontWeight:800,color:"var(--t1)",lineHeight:1.1}}>{val}</div>
          {sub&&<div style={{fontSize:10,color:"var(--t3)",marginTop:3}}>{sub}</div>}
        </div>
      ))}
    </div>

    {/* Exit penalty warning */}
    {ymEst!=null&&<div style={{background:"#fffbeb",border:"1px solid #fde68a",borderRadius:10,padding:"12px 16px",marginBottom:20,fontSize:13}}>
      <strong style={{color:"#92400e"}}>⚠️ Yield Maintenance Penalty:</strong>
      <span style={{color:"#78350f",marginLeft:8}}>Est. {f$(ymEst)} — get exact figure from servicer before proceeding</span>
    </div>}

    {/* ── LENDER QUOTES ── */}
    <div style={{fontSize:13,fontWeight:700,color:"var(--t1)",marginBottom:6,textTransform:"uppercase",letterSpacing:".05em"}}>💬 Potential Lender Quotes</div>
    <div style={{fontSize:12,color:"var(--t3)",marginBottom:14}}>Enter quotes from lenders below. Leave blank if not yet received. Best deal highlights automatically.</div>
    <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:14,marginBottom:24}}>
      {qcalc.map((q,i)=>{
        const isBest=i===bi&&q.pmt!=null;
        return(
          <div key={i} style={{...CARD,border:`2px solid ${isBest?"var(--green)":"var(--bd)"}`,position:"relative"}}>
            {isBest&&<div style={{position:"absolute",top:-10,left:16,background:"var(--green)",color:"#fff",fontSize:9,fontWeight:800,padding:"2px 10px",borderRadius:20,letterSpacing:".06em"}}>BEST DEAL</div>}
            {/* Lender name */}
            <input placeholder="Lender name" value={q.name} onChange={e=>setQ(i,"name",e.target.value)}
              style={{width:"100%",border:"none",borderBottom:"2px solid var(--bd2)",background:"transparent",fontSize:14,fontWeight:700,color:"var(--t1)",padding:"4px 0",marginBottom:14,outline:"none"}}/>
            {/* Input fields */}
            {[
              ["Rate (%)",         "rate",  "0.001","e.g. 6.250"],
              ["Amortization (yr)","amort", "1",    "e.g. 30"],
              ["Loan Term (yr)",   "term",  "1",    "e.g. 7"],
              ["Closing Costs (%)", "costs","0.1",  "e.g. 1.0"],
            ].map(([lbl,key,step,ph])=>(
              <div key={key} style={{marginBottom:10}}>
                <div style={{fontSize:10,color:"var(--t3)",fontWeight:600,marginBottom:3}}>{lbl}</div>
                <input type="number" step={step} placeholder={ph} value={q[key]} onChange={e=>setQ(i,key,e.target.value)}
                  style={{width:"100%",padding:"8px 10px",borderRadius:7,border:"1px solid var(--bd)",background:"var(--bg)",color:"var(--t1)",fontSize:13,fontWeight:600,outline:"none"}}/>
              </div>
            ))}
            <input placeholder="Notes (optional)" value={q.notes} onChange={e=>setQ(i,"notes",e.target.value)}
              style={{width:"100%",padding:"6px 10px",borderRadius:7,border:"1px solid var(--bd)",background:"var(--bg)",color:"var(--t3)",fontSize:11,outline:"none",marginBottom:12}}/>
            {/* Results — only show if rate entered */}
            {q.pmt!=null&&<>
              <div style={{borderTop:"2px solid var(--bd2)",paddingTop:12,marginTop:4}}>
                <div style={{fontSize:10,fontWeight:700,color:"var(--t3)",textTransform:"uppercase",letterSpacing:".06em",marginBottom:8}}>Projected Outcome</div>
                {[
                  ["New Monthly Pmt",   f$(q.pmt),                    q.diff>0?"green":q.diff<0?"red":""],
                  ["vs. Current",       `${q.diff>=0?"+":""}${f$(q.diff)}/mo`, q.diff>=0?"green":"red"],
                  ["Annual DS",         f$(q.annNew),                 ""],
                  ["Annual Savings",    f$(Math.abs(q.diff*12)),      q.diff>0?"green":q.diff<0?"red":""],
                  ["Closing Costs",     f$(q.costAmt),                "amber"],
                  ["Breakeven",         q.be?`${q.be} months`:(q.costAmt===0?"Immediate":"N/A"), q.be&&q.be<24?"green":q.be&&q.be<48?"amber":""],
                  ["10-yr Net Savings", q.net10!=null?`${q.net10>=0?"":"-"}${f$(Math.abs(q.net10))}`:"—", q.net10!=null&&q.net10>0?"green":"red"],
                ].map(([lbl,val,cls])=>(
                  <div key={lbl} style={{...ROW}}>
                    <span style={LBL}>{lbl}</span>
                    <span style={{...VAL,color:cls==="green"?"var(--green)":cls==="red"?"var(--red)":cls==="amber"?"var(--amber)":"var(--t1)"}}>{val}</span>
                  </div>
                ))}
              </div>
            </>}
            {q.pmt==null&&<div style={{textAlign:"center",padding:"20px 0",color:"var(--t4)",fontSize:11}}>Enter rate + amortization<br/>to see projections</div>}
          </div>
        );
      })}
    </div>

    {/* ── COMPARISON SUMMARY — only if 2+ quotes filled ── */}
    {filledQuotes.length>=2&&<>
      <div style={{fontSize:13,fontWeight:700,color:"var(--t1)",marginBottom:10,textTransform:"uppercase",letterSpacing:".05em"}}>📊 Side-by-Side Comparison</div>
      <div style={{...CARD,marginBottom:24,overflowX:"auto"}}>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
          <thead>
            <tr>
              <th style={{padding:"8px 12px",textAlign:"left",fontSize:10,color:"var(--t3)",fontWeight:700,textTransform:"uppercase",borderBottom:"2px solid var(--bd)"}}>Metric</th>
              <th style={{padding:"8px 12px",textAlign:"center",fontSize:10,color:"var(--t3)",fontWeight:700,textTransform:"uppercase",borderBottom:"2px solid var(--bd)"}}>Current Loan</th>
              {qcalc.filter(q=>q.pmt!=null).map((q,i)=>(
                <th key={i} style={{padding:"8px 12px",textAlign:"center",fontSize:10,fontWeight:700,textTransform:"uppercase",borderBottom:"2px solid var(--bd)",color:i===bi?"var(--green)":"var(--t3)"}}>{q.name||`Quote ${i+1}`}{i===bi?" ⭐":""}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[
              ["Rate",          fPct(sel.rate),    qcalc.filter(q=>q.pmt!=null).map(q=>fPct(parseFloat(q.rate)))],
              ["Monthly Pmt",   f$(cp),            qcalc.filter(q=>q.pmt!=null).map(q=>f$(q.pmt))],
              ["Annual DS",     f$(annualDS),      qcalc.filter(q=>q.pmt!=null).map(q=>f$(q.annNew))],
              ["Monthly Δ",     "—",               qcalc.filter(q=>q.pmt!=null).map(q=>`${q.diff>=0?"+":""}${f$(q.diff)}`)],
              ["Closing Costs", "—",               qcalc.filter(q=>q.pmt!=null).map(q=>f$(q.costAmt))],
              ["Breakeven",     "—",               qcalc.filter(q=>q.pmt!=null).map(q=>q.be?`${q.be} mo`:"N/A")],
            ].map(([lbl,cur,vals])=>(
              <tr key={lbl} style={{borderBottom:"1px solid var(--bd2)"}}>
                <td style={{padding:"9px 12px",color:"var(--t3)",fontWeight:600}}>{lbl}</td>
                <td style={{padding:"9px 12px",textAlign:"center",fontWeight:700,color:"var(--t1)"}}>{cur}</td>
                {vals.map((v,i)=>(
                  <td key={i} style={{padding:"9px 12px",textAlign:"center",fontWeight:700,color:i===bi?"var(--green)":"var(--t1)"}}>{v}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>}
    </>}
    {!sel&&<div style={{textAlign:"center",padding:"60px",color:"var(--t3)"}}>Select a property above to begin</div>}
  </div>);
}

/* ─────────── ADD / EDIT LOAN MODAL ─────────── */
function LoanModal({onSave,onClose,initial}){
  const isEdit=!!initial;
  const blank={addr:"",entity:"",lender:"",lenderType:"Regional Bank",loanType:"Fixed",origBalance:"",rate:"",termYears:"",origDate:"",maturityDate:"",amortYears:"",prepay:"",recourse:true,guarantor:"",escrow:"",extensionOptions:"",refiStatus:"Not Started",servicerName:"",servicerPhone:"",servicerEmail:"",brokerName:"",brokerPhone:"",notes:"",activityLog:[],annualNOI:"",dscrCovenant:"",capProvider:"",capRate:"",capExpiry:""};
  const [f,setF]=useState(isEdit?{...blank,...initial,origBalance:String(initial.origBalance||""),rate:String(initial.rate||""),termYears:String(initial.termYears||""),amortYears:String(initial.amortYears||""),annualNOI:String(initial.annualNOI||""),dscrCovenant:String(initial.dscrCovenant||""),capRate:String(initial.capRate||"")}:blank);
  const s=(k,v)=>setF(p=>({...p,[k]:v}));
  const isIO=f.loanType==="IO"||f.loanType==="Bridge";
  const [section,setSection]=useState("property");
  const sections=[["property","🏠 Property"],["terms","📋 Loan Terms"],["contacts","📞 Contacts"],["financials","📊 Financials"]];

  const save=()=>{
    if(!f.addr||!f.lender||!f.origBalance||!f.rate||!f.maturityDate){alert("Required: Address, Lender, Balance, Rate, Maturity Date");return;}
    const parsed={...f,interestOnly:isIO,origBalance:parseFloat(f.origBalance)||0,rate:parseFloat(f.rate)||0,termYears:parseInt(f.termYears)||1,amortYears:parseInt(f.amortYears)||0,annualNOI:parseFloat(f.annualNOI)||null,dscrCovenant:parseFloat(f.dscrCovenant)||null,capRate:parseFloat(f.capRate)||null};
    if(isEdit) onSave(initial.id,parsed);
    else onSave({...parsed,id:Date.now(),activityLog:[]});
  };

  const Field=({label,k,type="text",opts,placeholder,req})=>(
    <div className="fg">
      <div className="flbl">{label}{req&&<span style={{color:"var(--red)",marginLeft:2}}>*</span>}</div>
      {opts?<select className="finp" value={f[k]} onChange={e=>s(k,e.target.value)}>{opts.map(o=><option key={o.v||o} value={o.v||o}>{o.l||o}</option>)}</select>
           :<input className="finp" type={type} step={type==="number"?"any":undefined} placeholder={placeholder} value={f[k]||""} onChange={e=>s(k,type==="number"?e.target.value:e.target.value)}/>}
    </div>
  );

  return(<div className="ov-modal" onClick={e=>e.target===e.currentTarget&&onClose()}>
    <div className="ov-mbox" style={{maxWidth:680}}>
      <div className="ov-mhd">
        <div className="ov-mtitle">{isEdit?`✏️ Edit — ${initial.addr}`:"+ Add New Loan"}</div>
        <button className="ov-mclose" onClick={onClose}>✕</button>
      </div>

      {/* Section tabs */}
      <div style={{display:"flex",gap:2,padding:"10px 20px 0",borderBottom:"1px solid var(--bd)",background:"var(--bg)"}}>
        {sections.map(([id,lbl])=>(
          <button key={id} onClick={()=>setSection(id)} style={{padding:"7px 14px",border:"none",borderBottom:`2px solid ${section===id?"var(--t1)":"transparent"}`,background:"transparent",fontSize:12,fontWeight:section===id?700:400,color:section===id?"var(--t1)":"var(--t3)",cursor:"pointer",marginBottom:-1}}>{lbl}</button>
        ))}
      </div>

      <div className="ov-mbody">
        {section==="property"&&<>
          <div className="fg-2">
            <Field label="Street Address" k="addr" req placeholder="160 Parkside Avenue"/>
            <Field label="Legal Entity" k="entity" placeholder="M&M Parkside LLC"/>
          </div>
        </>}

        {section==="terms"&&<>
          <div className="fg-2">
            <Field label="Lender" k="lender" req placeholder="Flagstar Bank"/>
            <Field label="Lender Type" k="lenderType" opts={["Agency","Regional Bank","National Bank","Life Company","Bridge","Special Servicer","Other"]}/>
            <Field label="Loan Type" k="loanType" opts={[{v:"Fixed",l:"Fixed Rate"},{v:"ARM",l:"ARM"},{v:"IO",l:"Interest Only"},{v:"Bridge",l:"Bridge"},{v:"SOFR",l:"SOFR"}]}/>
            <Field label="Interest Rate (%)" k="rate" type="number" req placeholder="5.25"/>
            <Field label="Original Balance ($)" k="origBalance" type="number" req placeholder="5000000"/>
            <Field label="Term (Years)" k="termYears" type="number" placeholder="10"/>
            {!isIO&&<Field label="Amortization (Years)" k="amortYears" type="number" placeholder="30"/>}
            <Field label="Origination Date" k="origDate" type="date"/>
            <Field label="Maturity Date" k="maturityDate" type="date" req/>
            <Field label="Prepay Terms" k="prepay" placeholder="e.g. YM, Defeasance, 5-4-3-2-1, 1%"/>
            <Field label="Recourse" k="recourse" opts={[{v:"true",l:"Recourse"},{v:"false",l:"Non-Recourse"}]}/>
            <Field label="Guarantor" k="guarantor" placeholder="Owner personal guarantee"/>
            <Field label="Escrow" k="escrow" placeholder="Tax & Insurance"/>
            <Field label="Extension Options" k="extensionOptions" placeholder="1×1yr at lender discretion"/>
            <Field label="Refi Status" k="refiStatus" opts={REFI_STAGES}/>
          </div>
        </>}

        {section==="contacts"&&<>
          <div className="fg-2">
            <Field label="Servicer Name" k="servicerName" placeholder="Arbor Realty"/>
            <Field label="Servicer Phone" k="servicerPhone" placeholder="800-555-0100"/>
            <Field label="Servicer Email" k="servicerEmail" placeholder="servicing@lender.com"/>
            <Field label="Broker / Arranger" k="brokerName" placeholder="Eastern Union"/>
            <Field label="Broker Phone" k="brokerPhone" placeholder="212-555-0100"/>
          </div>
        </>}

        {section==="financials"&&<>
          <div className="fg-2">
            <Field label="Annual NOI ($)" k="annualNOI" type="number" placeholder="480000"/>
            <Field label="DSCR Covenant" k="dscrCovenant" type="number" placeholder="1.20"/>
            <Field label="Cap Provider" k="capProvider" placeholder="SMBC"/>
            <Field label="Cap Strike Rate (%)" k="capRate" type="number" placeholder="7.50"/>
            <Field label="Cap Expiry Date" k="capExpiry" type="date"/>
          </div>
          <Field label="Notes" k="notes"/>
          <textarea className="notes-ta" rows={4} placeholder="Key notes, action items, special terms, watch items…" value={f.notes||""} onChange={e=>s("notes",e.target.value)}/>
        </>}

        <div className="mfooter" style={{marginTop:20}}>
          <div style={{display:"flex",gap:8}}>
            {sections.map(([id],i)=>i>0&&<button key={id} className="btn-light" style={{fontSize:11}} onClick={()=>setSection(sections[i-1][0])}>← {sections[i-1][1].split(" ")[1]}</button>).filter(Boolean)[sections.findIndex(s=>s[0]===section)-1]||<div/>}
          </div>
          <div style={{display:"flex",gap:8}}>
            <button className="btn-light" onClick={onClose}>Cancel</button>
            {sections.findIndex(s=>s[0]===section)<sections.length-1
              ?<button className="btn-dark" onClick={()=>setSection(sections[sections.findIndex(s=>s[0]===section)+1][0])}>Next →</button>
              :<button className="btn-dark" onClick={save}>{isEdit?"💾 Save Changes":"✓ Add Loan"}</button>
            }
          </div>
        </div>
      </div>
    </div>
  </div>);
}



/* ─────────── PIE CHART ─────────── */
function PieChart({slices,size=160,title,legend=true}){
  const total=slices.reduce((s,x)=>s+x.val,0);
  if(total===0)return null;
  let cum=0;
  const TAU=2*Math.PI;
  const cx=size/2,cy=size/2,r=size/2-2,ri=r*0.52;
  const [hov,setHov]=useState(null);
  const paths=slices.map((sl,i)=>{
    const start=cum/total*TAU-TAU/4;
    cum+=sl.val;
    const end=cum/total*TAU-TAU/4;
    const gap=0.018;
    const s=start+gap,e=end-gap;
    if(e<=s)return null;
    const x1=cx+r*Math.cos(s),y1=cy+r*Math.sin(s);
    const x2=cx+r*Math.cos(e),y2=cy+r*Math.sin(e);
    const xi1=cx+ri*Math.cos(s),yi1=cy+ri*Math.sin(s);
    const xi2=cx+ri*Math.cos(e),yi2=cy+ri*Math.sin(e);
    const big=(e-s)>Math.PI?1:0;
    const scale=hov===i?1.04:1;
    return(
      <g key={i} style={{cursor:"pointer",transform:`scale(${scale})`,transformOrigin:`${cx}px ${cy}px`,transition:"transform .15s"}}
        onMouseEnter={()=>setHov(i)} onMouseLeave={()=>setHov(null)}>
        <path d={`M${xi1} ${yi1} L${x1} ${y1} A${r} ${r} 0 ${big} 1 ${x2} ${y2} L${xi2} ${yi2} A${ri} ${ri} 0 ${big} 0 ${xi1} ${yi1} Z`}
          fill={sl.color} opacity={hov===null||hov===i?1:0.6}/>
      </g>
    );
  });
  const hovSlice=hov!=null?slices[hov]:null;
  return(
    <div style={{display:"flex",flexDirection:"column",alignItems:"center"}}>
      {title&&<div style={{fontSize:11,fontWeight:700,color:"var(--t3)",letterSpacing:".06em",textTransform:"uppercase",marginBottom:10,textAlign:"center"}}>{title}</div>}
      <div style={{position:"relative",width:size,height:size,flexShrink:0}}>
        <svg width={size} height={size}>{paths}</svg>
        <div style={{position:"absolute",inset:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",pointerEvents:"none",padding:"20%",textAlign:"center"}}>
          {hovSlice
            ?<><div style={{fontSize:10,fontWeight:700,color:hovSlice.color,lineHeight:1.2}}>{hovSlice.label}</div>
               <div style={{fontSize:13,fontWeight:800,color:"var(--t1)",marginTop:2}}>{hovSlice.val>=1e6?`$${(hovSlice.val/1e6).toFixed(1)}M`:hovSlice.val>=1e3?`$${(hovSlice.val/1e3).toFixed(0)}K`:`$${Math.round(hovSlice.val).toLocaleString()}`}</div>
               <div style={{fontSize:9,color:"var(--t3)",marginTop:1}}>{(hovSlice.val/total*100).toFixed(1)}%</div></>
            :<><div style={{fontSize:9,color:"var(--t3)"}}>TOTAL</div>
               <div style={{fontSize:13,fontWeight:800,color:"var(--t1)"}}>{total>=1e6?`$${(total/1e6).toFixed(1)}M`:total>=1e3?`$${(total/1e3).toFixed(0)}K`:`$${Math.round(total).toLocaleString()}`}</div></>
          }
        </div>
      </div>
      {legend&&<div style={{marginTop:12,width:"100%"}}>
        {slices.map((sl,i)=>(
          <div key={i} style={{display:"flex",alignItems:"center",gap:6,marginBottom:4,cursor:"pointer",opacity:hov===null||hov===i?1:0.5,transition:"opacity .15s"}}
            onMouseEnter={()=>setHov(i)} onMouseLeave={()=>setHov(null)}>
            <div style={{width:8,height:8,borderRadius:2,background:sl.color,flexShrink:0}}/>
            <div style={{fontSize:10,color:"var(--t2)",flex:1,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{sl.label}</div>
            <div style={{fontSize:10,fontWeight:600,color:"var(--t3)",flexShrink:0}}>{(sl.val/total*100).toFixed(0)}%</div>
          </div>
        ))}
      </div>}
    </div>
  );
}

/* ─────────── OVERVIEW ─────────── */
function Overview({loans,onSelect,onAdd,dbStatus,dbError}){
  const [ovTab,setOvTab]=useState("loans"); // loans | actions
  const en=useMemo(()=>loans.map(enrich),[loans]);

  // ── KPIs ────────────────────────────────────────────────────────────────────
  const tb        = loans.reduce((s,l)=>s+(l.currentBalance||l.origBalance||0),0);
  const origTotal = loans.reduce((s,l)=>s+(l.origBalance||0),0);
  const wac       = en.reduce((s,l)=>s+l.rate*(l.currentBalance||l.origBalance||0),0)/Math.max(1,tb);
  const monthlyDS = en.reduce((s,l)=>s+(isNaN(l.pmt)?0:l.pmt),0);
  const annualDS  = monthlyDS*12;
  const urg       = en.filter(l=>l.status==="urgent"||l.status==="matured");
  const matured   = en.filter(l=>l.status==="matured");
  const inRefi    = en.filter(l=>l.refiStatus&&l.refiStatus!=="Not Started"&&l.refiStatus!=="Closed");
  const ioLoans   = en.filter(l=>l.interestOnly||l.loanType==="IO");
  const ioDebt    = ioLoans.reduce((s,l)=>s+(l.currentBalance||l.origBalance||0),0);
  const fixedLoans= en.filter(l=>!l.interestOnly&&l.loanType!=="IO"&&l.loanType!=="ARM");
  const avgLoan   = loans.length>0?tb/loans.length:0;
  const payingDown= origTotal>0?((origTotal-tb)/origTotal*100):0;

  // Lender concentration — top lender by balance
  const byLender={};
  loans.forEach(l=>{const k=l.lender||"Unknown";byLender[k]=(byLender[k]||0)+(l.currentBalance||l.origBalance||0);});
  const topLender=Object.entries(byLender).sort((a,b)=>b[1]-a[1])[0]||["—",0];
  const topLenderPct=tb>0?(topLender[1]/tb*100):0;

  // Maturities by year
  const byYear={};
  en.forEach(l=>{
    if(!l.maturityDate)return;
    const y=new Date(l.maturityDate).getFullYear();
    if(isNaN(y))return;
    if(!byYear[y])byYear[y]={count:0,bal:0,urgent:0,loans:[]};
    byYear[y].count++;
    byYear[y].bal+=(l.currentBalance||l.origBalance||0);
    if(l.status==="urgent"||l.status==="matured")byYear[y].urgent++;
    byYear[y].loans.push(l);
  });
  const matByYear=Object.entries(byYear).sort((a,b)=>Number(a[0])-Number(b[0]));

  // Alerts
  const alerts=[];
  en.filter(l=>l.status==="matured").forEach(l=>alerts.push({cls:"al-red",ic:"🔴",hl:`${l.addr} — PAST MATURITY`,detail:`${f$(l.currentBalance||l.curBal)} · ${l.lender} · ${l.daysLeft!=null?Math.abs(l.daysLeft)+" days overdue":""}`,action:"Contact lender immediately",id:l.id}));
  en.filter(l=>l.status==="urgent").forEach(l=>alerts.push({cls:"al-red",ic:"⚠",hl:`${l.addr} — matures ${fDateS(l.maturityDate)}`,detail:`${f$(l.currentBalance||l.curBal)} · ${l.lender} · ${l.daysLeft!=null?l.daysLeft+" days remaining":""}`,action:"Begin refinancing now",id:l.id}));
  en.filter(l=>l.dscr&&l.dscrCovenant&&l.dscr<l.dscrCovenant).forEach(l=>alerts.push({cls:"al-red",ic:"📊",hl:`${l.addr} — DSCR below covenant (${l.dscr?.toFixed(2)}x vs ${l.dscrCovenant}x)`,detail:l.lender,action:"Address NOI shortfall or request waiver",id:l.id}));
  en.filter(l=>l.capExpiring).forEach(l=>alerts.push({cls:"al-amber",ic:"📉",hl:`${l.addr} — rate cap expires ${fDateS(l.capExpiry)}`,detail:"Cap expires before loan maturity",action:"Purchase new cap or begin refi",id:l.id}));
  en.filter(l=>l.status==="soon").forEach(l=>alerts.push({cls:"al-amber",ic:"◎",hl:`${l.addr} — matures ${fDateS(l.maturityDate)}`,detail:l.daysLeft!=null?`${Math.round(l.daysLeft/30)} months away`:"",action:"Begin lender conversations",id:l.id}));

  const SC=(label,val,sub,cls="")=>(
    <div className="scard">
      <div className="sc-lbl">{label}</div>
      <div className={`sc-val${cls?" "+cls:""}`}>{val}</div>
      {sub&&<div className="sc-sub">{sub}</div>}
    </div>
  );

  // ── Chart data ─────────────────────────────────────────────────────────────
  // 1. IO vs Amortizing vs Bridge
  const ioAmt   = loans.filter(l=>l.loanType==="IO"||l.interestOnly).reduce((s,l)=>s+(l.currentBalance||l.origBalance||0),0);
  const bridgeAmt= loans.filter(l=>l.loanType==="Bridge").reduce((s,l)=>s+(l.currentBalance||l.origBalance||0),0);
  const amorAmt = tb - ioAmt - bridgeAmt;
  const ioSlices=[
    {label:"Interest Only",val:ioAmt,color:"#f59e0b"},
    {label:"Amortizing",val:Math.max(0,amorAmt),color:"#10b981"},
    {label:"Bridge",val:bridgeAmt,color:"#6366f1"},
  ].filter(s=>s.val>0);

  // 2. Rate Tiers
  const rateTiers=[
    {label:"Sub 4%",val:0,color:"#10b981"},
    {label:"4% – 5%",val:0,color:"#34d399"},
    {label:"5% – 6%",val:0,color:"#f59e0b"},
    {label:"6%+",val:0,color:"#ef4444"},
  ];
  loans.forEach(l=>{
    const b=l.currentBalance||l.origBalance||0;
    const r=l.rate||0;
    if(r<4)rateTiers[0].val+=b;
    else if(r<5)rateTiers[1].val+=b;
    else if(r<6)rateTiers[2].val+=b;
    else rateTiers[3].val+=b;
  });
  const rateSlices=rateTiers.filter(s=>s.val>0);

  // 3. Lender concentration (top 6 + Other)
  const lenderMap={};
  loans.forEach(l=>{const k=l.lender||"Unknown";lenderMap[k]=(lenderMap[k]||0)+(l.currentBalance||l.origBalance||0);});
  const lenderColors=["#3b82f6","#8b5cf6","#f59e0b","#10b981","#ef4444","#06b6d4","#94a3b8"];
  const lenderSorted=Object.entries(lenderMap).sort((a,b)=>b[1]-a[1]);
  const top6=lenderSorted.slice(0,6);
  const otherVal=lenderSorted.slice(6).reduce((s,[,v])=>s+v,0);
  const lenderSlices=[...top6.map(([k,v],i)=>({label:k,val:v,color:lenderColors[i]})),
    ...(otherVal>0?[{label:"Other",val:otherVal,color:"#94a3b8"}]:[])];

  // 4. Maturity Buckets
  const NOW_YR=new Date().getFullYear();
  const matBuckets=[
    {label:"Past Due",val:0,color:"#dc2626"},
    {label:"2026",val:0,color:"#f97316"},
    {label:"2027",val:0,color:"#f59e0b"},
    {label:"2028",val:0,color:"#84cc16"},
    {label:"2029+",val:0,color:"#10b981"},
    {label:"No Date",val:0,color:"#94a3b8"},
  ];
  loans.forEach(l=>{
    const b=l.currentBalance||l.origBalance||0;
    if(!l.maturityDate){matBuckets[5].val+=b;return;}
    const yr=new Date(l.maturityDate).getFullYear();
    if(isNaN(yr)){matBuckets[5].val+=b;return;}
    const d=daysTo(l.maturityDate);
    if(d!=null&&d<0)matBuckets[0].val+=b;
    else if(yr<=2026)matBuckets[1].val+=b;
    else if(yr===2027)matBuckets[2].val+=b;
    else if(yr===2028)matBuckets[3].val+=b;
    else matBuckets[4].val+=b;
  });
  const matSlices=matBuckets.filter(s=>s.val>0);

  if(loans.length===0){return(<div>
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
      <div><div style={{fontSize:22,fontWeight:700,color:"var(--t1)"}}>Portfolio Overview</div><div style={{fontSize:13,color:"var(--t3)",marginTop:2}}>Brooklyn, NY · Debt Management</div></div>
    </div>
    {dbStatus==="error"&&<div style={{background:"#fef2f2",border:"1px solid #fca5a5",borderRadius:10,padding:"14px 18px",marginBottom:16,fontSize:13}}>
      <strong style={{color:"#dc2626"}}>⚠️ Database connection error:</strong>
      <div style={{color:"#991b1b",marginTop:4,fontFamily:"monospace",fontSize:12}}>{dbError}</div>
      <div style={{color:"#7f1d1d",marginTop:6}}>Go to Supabase → SQL Editor and run <strong>setup_loans_table_v2.sql</strong> then <strong>insert_loans_v2.sql</strong></div>
    </div>}
    {dbStatus==="loading"&&<div style={{background:"#eff6ff",border:"1px solid #bfdbfe",borderRadius:10,padding:"14px 18px",marginBottom:16,fontSize:13,color:"#1d4ed8"}}>⏳ Connecting to database...</div>}
    {dbStatus==="empty"&&<div style={{background:"#fffbeb",border:"1px solid #fde68a",borderRadius:10,padding:"14px 18px",marginBottom:16,fontSize:13}}>
      <strong style={{color:"#92400e"}}>📋 Database connected but no loans found.</strong>
      <div style={{color:"#78350f",marginTop:4}}>Run <strong>insert_loans_v2.sql</strong> in Supabase SQL Editor to load your 77 loans — or add them manually below.</div>
    </div>}
    <div style={{background:"var(--white)",border:"2px dashed var(--bd2)",borderRadius:20,padding:"64px 40px",textAlign:"center",marginTop:20}}>
      <div style={{fontSize:48,marginBottom:16,opacity:.2}}>🏛</div>
      <div style={{fontSize:20,fontWeight:700,color:"var(--t1)",marginBottom:8}}>No loans yet</div>
      <div style={{fontSize:13,color:"var(--t3)",lineHeight:1.7,maxWidth:400,margin:"0 auto 28px"}}>Add your first mortgage to start tracking balances, maturities, debt service, and refinancing activity across your portfolio.</div>
      <button className="btn-dark" onClick={onAdd} style={{fontSize:14,padding:"11px 28px"}}>+ Add Your First Loan</button>
    </div>
  </div>);}

  return(<div>
    {/* ── Header ── */}
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
      <div>
        <div style={{fontSize:22,fontWeight:700,color:"var(--t1)"}}>Portfolio Overview</div>
        <div style={{fontSize:13,color:"var(--t3)",marginTop:2}}>Brooklyn, NY · {loans.length} loans · {new Date().toLocaleDateString("en-US",{month:"long",year:"numeric"})}</div>
      </div>
      <button className="btn-dark" onClick={onAdd}>+ Add Loan</button>
    </div>

    {/* ── KPI Row 1 — Debt & Cash Flow ── */}
    <div style={{fontSize:11,fontWeight:700,color:"var(--t3)",letterSpacing:".08em",textTransform:"uppercase",marginBottom:8}}>Debt & Cash Flow</div>
    <div className="ov-stats" style={{gridTemplateColumns:"repeat(5,1fr)",marginBottom:14}}>
      {SC("Original Loan Total",f$(origTotal),"sum of all original loans")}
      {SC("Current Debt Total",f$(tb),"sum of current balances")}
      {SC("Monthly Debt Service",f$(monthlyDS),"est. all loans combined")}
      {SC("Annual Debt Service",f$(annualDS),"total yearly payments")}
      {SC("Avg Loan Size",f$(avgLoan),`across ${loans.length} loans`)}
    </div>

    {/* ── KPI Row 2 — Rate & Structure ── */}
    <div style={{fontSize:11,fontWeight:700,color:"var(--t3)",letterSpacing:".08em",textTransform:"uppercase",marginBottom:8}}>Rate & Structure</div>
    <div className="ov-stats" style={{gridTemplateColumns:"repeat(4,1fr)",marginBottom:14}}>
      {SC("Wtd. Avg. Rate",fPct(wac),"weighted by balance","amber")}
      {SC("IO Exposure",f$(ioDebt),`${ioLoans.length} interest-only loans`,"amber")}
      {SC("Amortizing Debt",f$(fixedLoans.reduce((s,l)=>s+(l.currentBalance||l.origBalance||0),0)),`${fixedLoans.length} fixed/amortizing loans`)}
      {SC("Principal Paid Down",`${payingDown.toFixed(1)}%`,`$${((origTotal-tb)/1e6).toFixed(1)}M from original`,"green")}
    </div>

    {/* ── KPI Row 3 — Risk ── */}
    <div style={{fontSize:11,fontWeight:700,color:"var(--t3)",letterSpacing:".08em",textTransform:"uppercase",marginBottom:8}}>Maturity Risk</div>
    <div className="ov-stats" style={{gridTemplateColumns:"repeat(4,1fr)",marginBottom:20}}>
      {SC("Past Maturity",matured.length,matured.length>0?"urgent — contact lenders":"all current","red")}
      {SC("Maturing ≤6 Months",urg.length,`$${(urg.reduce((s,l)=>s+(l.currentBalance||l.origBalance||0),0)/1e6).toFixed(1)}M at risk`,urg.length>0?"red":"")}
      {SC("Refi In Progress",inRefi.length,"loans being refinanced","blue")}
      {SC("Top Lender Concentration",topLender[0].length>12?topLender[0].slice(0,12)+"…":topLender[0],`${topLenderPct.toFixed(0)}% of portfolio`)}
    </div>

    {/* ── Charts ── */}
    <div style={{fontSize:11,fontWeight:700,color:"var(--t3)",letterSpacing:".08em",textTransform:"uppercase",marginBottom:12}}>Portfolio Composition</div>
    <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:16,marginBottom:24,background:"var(--white)",border:"1px solid var(--bd)",borderRadius:14,padding:"20px 16px"}}>
      <PieChart slices={ioSlices} title="IO vs Amortizing vs Bridge" size={160}/>
      <PieChart slices={rateSlices} title="Debt by Rate Tier" size={160}/>
      <PieChart slices={lenderSlices} title="Debt by Lender" size={160}/>
      <PieChart slices={matSlices} title="Maturity Buckets" size={160}/>
    </div>

    {/* ── Urgent Maturities (within 6 months) ── */}
    {urg.length>0&&<>
      <div style={{fontSize:13,fontWeight:700,color:"var(--t1)",marginBottom:8,display:"flex",alignItems:"center",gap:8}}>
        🔴 Urgent Maturities — Within 6 Months
        <span style={{fontSize:11,fontWeight:400,color:"var(--t3)"}}>{f$(urg.reduce((s,l)=>s+(l.currentBalance||l.origBalance||0),0))} total exposure</span>
      </div>
      <div style={{border:"1px solid #fecaca",borderRadius:10,overflow:"hidden",marginBottom:20}}>
        <table className="tbl" style={{margin:0}}>
          <thead><tr style={{background:"#fef2f2"}}>
            <th>Address</th><th>Lender</th><th>Balance</th><th>Rate</th><th>Maturity</th><th>Days Left</th><th>Refi Status</th>
          </tr></thead>
          <tbody>{[...urg].sort((a,b)=>(a.daysLeft??9999)-(b.daysLeft??9999)).map(l=>(
            <tr key={l.id} onClick={()=>onSelect(loans.find(x=>x.id===l.id))} style={{cursor:"pointer"}}>
              <td><div className="td-a">{l.addr}</div><div className="td-b">{l.lender}</div></td>
              <td><span style={{fontSize:12,color:"var(--t2)"}}>{l.lender}</span></td>
              <td><span className="td-n">{f$(l.currentBalance||l.curBal)}</span></td>
              <td><span className="td-n red">{fPct(l.rate)}</span></td>
              <td><span style={{fontSize:12}}>{fDateS(l.maturityDate)||"—"}</span></td>
              <td><span style={{fontSize:12,fontWeight:700,color:l.daysLeft<0?"#dc2626":"#d97706"}}>{l.daysLeft!=null?(l.daysLeft<0?`${Math.abs(l.daysLeft)}d overdue`:`${l.daysLeft}d left`):"—"}</span></td>
              <td><RefiChip status={l.refiStatus}/></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </>}

    {/* ── Maturities by Year ── */}
    <div style={{fontSize:13,fontWeight:700,color:"var(--t1)",marginBottom:10}}>Maturities by Year</div>
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(160px,1fr))",gap:8,marginBottom:20}}>
      {matByYear.map(([yr,d])=>{
        const isUrgent=Number(yr)<=2026;
        const isSoon=Number(yr)===2027;
        const bg=isUrgent?"#fef2f2":isSoon?"#fffbeb":"var(--white)";
        const border=isUrgent?"#fecaca":isSoon?"#fde68a":"var(--bd)";
        const valColor=isUrgent?"#dc2626":isSoon?"#d97706":"var(--t1)";
        return(
          <div key={yr} style={{background:bg,border:`1px solid ${border}`,borderRadius:10,padding:"12px 14px"}}>
            <div style={{fontSize:11,fontWeight:700,color:"var(--t3)",marginBottom:4}}>{yr}</div>
            <div style={{fontSize:20,fontWeight:800,color:valColor,marginBottom:2}}>{d.count}</div>
            <div style={{fontSize:11,color:"var(--t3)"}}>{f$(d.bal)}</div>
            {d.urgent>0&&<div style={{fontSize:10,color:"#dc2626",marginTop:4,fontWeight:600}}>⚠ {d.urgent} urgent</div>}
          </div>
        );
      })}
    </div>

    {/* ── Tabs: All Loans / Action Required ── */}
    <div style={{display:"flex",gap:0,borderBottom:"2px solid var(--bd)",marginBottom:14}}>
      {[["loans",`All Loans (${loans.length})`],["actions",`Action Required (${alerts.length})`]].map(([id,lbl])=>(
        <button key={id} onClick={()=>setOvTab(id)} style={{
          padding:"8px 18px",border:"none",borderBottom:`2px solid ${ovTab===id?"var(--t1)":"transparent"}`,
          marginBottom:-2,background:"transparent",fontSize:13,fontWeight:ovTab===id?700:400,
          color:ovTab===id?"var(--t1)":"var(--t3)",cursor:"pointer"
        }}>{lbl}</button>
      ))}
    </div>

    {/* All Loans tab */}
    {ovTab==="loans"&&<div className="tbl-wrap">
      <table className="tbl">
        <thead><tr><th>Address</th><th>Lender</th><th>Orig Balance</th><th>Cur Balance</th><th>Rate</th><th>Maturity</th><th>Refi Status</th></tr></thead>
        <tbody>{[...en].sort((a,b)=>(a.daysLeft??99999)-(b.daysLeft??99999)).map(l=>(
          <tr key={l.id} onClick={()=>onSelect(loans.find(x=>x.id===l.id))}>
            <td><div className="td-a">{l.addr}</div><div className="td-b">{l.entity||""}</div></td>
            <td><span style={{fontSize:12,color:"var(--t2)"}}>{l.lender}</span></td>
            <td><span className="td-n" style={{color:"var(--t3)"}}>{f$(l.origBalance)}</span></td>
            <td><span className="td-n">{f$(l.currentBalance||l.curBal)}</span></td>
            <td><span className={`td-n${l.rate>7?" red":l.rate>5?" amber":" green"}`}>{fPct(l.rate)}</span></td>
            <td><MatChip loan={l}/></td>
            <td><RefiChip status={l.refiStatus}/></td>
          </tr>
        ))}</tbody>
        <tfoot>
          <tr style={{background:"var(--bg)",fontWeight:700,borderTop:"2px solid var(--bd)"}}>
            <td style={{fontSize:12,fontWeight:700,color:"var(--t1)",padding:"10px 12px"}}>TOTAL ({loans.length} loans)</td>
            <td/>
            <td><span className="td-n" style={{color:"var(--t3)",fontWeight:700}}>{f$(origTotal)}</span></td>
            <td><span className="td-n" style={{fontWeight:700}}>{f$(tb)}</span></td>
            <td><span className="td-n amber" style={{fontWeight:700}}>{fPct(wac)} avg</span></td>
            <td/><td/>
          </tr>
        </tfoot>
      </table>
    </div>}

    {/* Action Required tab */}
    {ovTab==="actions"&&<div>
      {alerts.length===0
        ?<div style={{padding:"40px",textAlign:"center",color:"var(--t3)",fontSize:13}}>✅ No actions required — portfolio looks clean.</div>
        :<div className="al-list">{alerts.map((a,i)=>(
          <div key={i} className={`al-row ${a.cls}`} onClick={()=>onSelect(loans.find(l=>l.id===a.id))}>
            <div className="al-ic">{a.ic}</div>
            <div><div className="al-hl">{a.hl}</div><div className="al-detail">{a.detail}</div><div className="al-action">→ {a.action}</div></div>
          </div>
        ))}</div>
      }
    </div>}
  </div>);
}

/* ─────────── ALL LOANS ─────────── */
function AllLoans({loans,onSelect,onAdd}){
  const [search,setSearch]=useState("");
  const [filt,setFilt]=useState("all");
  const [sort,setSort]=useState({k:"daysLeft",d:1});
  const en=useMemo(()=>loans.map(enrich),[loans]);
  const rows=useMemo(()=>en.filter(l=>{
    const sf=filt==="all"||filt===l.status||filt===l.loanType||filt===l.interestOnly&&filt==="IO";
    const ss=!search||l.addr.toLowerCase().includes(search.toLowerCase())||l.lender.toLowerCase().includes(search.toLowerCase());
    return sf&&ss;
  }).sort((a,b)=>(a[sort.k]>b[sort.k]?1:-1)*sort.d),[en,filt,search,sort]);
  const th=(lbl,k)=><th onClick={()=>setSort(s=>({k,d:s.k===k?-s.d:1}))}>{lbl}{sort.k===k?sort.d===1?" ↑":" ↓":""}</th>;
  if(loans.length===0){return(<div>
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
      <div style={{fontSize:22,fontWeight:700,color:"var(--t1)"}}>All Loans</div>
      <button className="btn-dark" onClick={onAdd}>+ Add Loan</button>
    </div>
    <div style={{background:"var(--white)",border:"2px dashed var(--bd2)",borderRadius:20,padding:"64px 40px",textAlign:"center"}}>
      <div style={{fontSize:48,marginBottom:16,opacity:.2}}>📋</div>
      <div style={{fontSize:18,fontWeight:700,color:"var(--t1)",marginBottom:8}}>No loans in the portfolio yet</div>
      <div style={{fontSize:13,color:"var(--t3)",marginBottom:24}}>Use the button above to add your first mortgage.</div>
      <button className="btn-dark" onClick={onAdd} style={{fontSize:14,padding:"11px 28px"}}>+ Add Loan</button>
    </div>
  </div>);}
  const exportCSV=()=>downloadCSV("all-loans.csv",
    ["Address","Entity","Lender","Type","Orig Balance","Cur Balance","Rate","Monthly Pmt","Annual DS","Maturity Date","Days Left","Status","DSCR","Refi Status","Prepay","Recourse"],
    loans.map(enrich).map(l=>[l.addr,l.entity||"",l.lender,l.loanType,l.origBalance,l.curBal.toFixed(0),l.rate,l.pmt.toFixed(0),l.annualDS.toFixed(0),l.maturityDate,l.daysLeft,l.status,l.dscr?l.dscr.toFixed(2):"",l.refiStatus||"",l.prepay||"",l.recourse?"Yes":"No"])
  );
  return(<div>
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14}}>
      <div style={{fontSize:22,fontWeight:700,color:"var(--t1)"}}>All Loans</div>
      <div style={{display:"flex",gap:8}}>
        <button className="btn-light" onClick={exportCSV}>⬇ Export CSV</button>
        <button className="btn-dark" onClick={onAdd}>+ Add Loan</button>
      </div>
    </div>
    <div className="frow" style={{flexWrap:"wrap",gap:6}}>
      <input className="f-inp" placeholder="Search address or lender…" value={search} onChange={e=>setSearch(e.target.value)}/>
      <span style={{fontSize:10,color:"var(--t3)",alignSelf:"center",fontWeight:600,marginLeft:4}}>STATUS:</span>
      {[["all","All"],["urgent","🔴 Urgent"],["soon","🟡 Soon"],["ok","✅ Current"],["matured","⚫ Matured"]].map(([id,lbl])=>(
        <button key={id} className={`fb${filt===id?" fa":""}`} onClick={()=>setFilt(id)}>{lbl}</button>
      ))}
      <span style={{fontSize:10,color:"var(--t3)",alignSelf:"center",fontWeight:600,marginLeft:4}}>TYPE:</span>
      {[["Fixed","Fixed"],["IO","IO"],["ARM","ARM"],["Bridge","Bridge"]].map(([id,lbl])=>(
        <button key={id} className={`fb${filt===id?" fa":""}`} onClick={()=>setFilt(id)}>{lbl}</button>
      ))}
      <span style={{fontSize:10,color:"var(--t3)",alignSelf:"center",fontWeight:600,marginLeft:4}}>SORT:</span>
      {[["daysLeft","Maturity"],["curBal","Balance"],["rate","Rate"],["addr","A–Z"],["lender","Lender"]].map(([k,lbl])=>(
        <button key={k} className={`fb${sort.k===k?" fa":""}`} onClick={()=>setSort(s=>({k,d:s.k===k?-s.d:1}))}>{lbl}{sort.k===k?(sort.d===1?" ↑":" ↓"):""}</button>
      ))}
      <span className="f-ct">{rows.length} of {loans.length}</span>
    </div>
    <div className="tbl-wrap">
      <table className="tbl">
        <thead><tr>{th("Address","addr")}{th("Lender","lender")}<th>Type</th>{th("Balance","curBal")}{th("Rate","rate")}{th("Payment","pmt")}{th("DSCR","dscr")}{th("Maturity","daysLeft")}<th>Refi</th></tr></thead>
        <tbody>{rows.map(l=>(
          <tr key={l.id} onClick={()=>onSelect(loans.find(x=>x.id===l.id))}>
            <td><div className="td-a">{l.addr}</div><div className="td-b">{l.entity||l.lenderType}</div></td>
            <td><div style={{fontSize:12,color:"var(--t2)"}}>{l.lender}</div></td>
            <td><span className="chip chip-grey">{l.loanType}</span></td>
            <td><span className="td-n">{f$(l.curBal)}</span></td>
            <td><span className={`td-n${l.rate>7?" red":l.rate>5?" amber":" green"}`}>{fPct(l.rate)}</span></td>
            <td><span className="td-n">{f$(l.pmt)}/mo</span></td>
            <td><span className={`td-n${l.dscr&&l.dscrCovenant&&l.dscr<l.dscrCovenant?" red":!l.dscr?" muted":l.dscr>1.3?" green":" amber"}`}>{l.dscr?l.dscr.toFixed(2)+"x":"—"}</span></td>
            <td><MatChip loan={l}/></td>
            <td><RefiChip status={l.refiStatus}/></td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  </div>);
}

/* ─────────── MATURITY TIMELINE ─────────── */
/* ─────────── REFI PIPELINE ─────────── */
const STAGE_META={
  "Not Started":          {color:"#64748b",bg:"#f8fafc",bd:"#e2e8f0",accent:"#94a3b8",icon:"○"},
  "Exploring":            {color:"#7c3aed",bg:"#faf5ff",bd:"#ddd6fe",accent:"#7c3aed",icon:"◎"},
  "LOI Received":         {color:"#1d4ed8",bg:"#eff6ff",bd:"#bfdbfe",accent:"#3b82f6",icon:"📄"},
  "Application Submitted":{color:"#0e7490",bg:"#ecfeff",bd:"#a5f3fc",accent:"#06b6d4",icon:"📝"},
  "Appraisal Ordered":    {color:"#b45309",bg:"#fffbeb",bd:"#fde68a",accent:"#f59e0b",icon:"🏠"},
  "Commitment Issued":    {color:"#15803d",bg:"#f0fdf4",bd:"#86efac",accent:"#22c55e",icon:"✅"},
  "Closed":               {color:"#14532d",bg:"#dcfce7",bd:"#6ee7b7",accent:"#16a34a",icon:"🎉"},
};

function RefiPipeline({loans,onSelect,onSave}){
  const en=useMemo(()=>loans.map(enrich),[loans]);
  const [dragging,setDragging]=useState(null);
  const [dragOver,setDragOver]=useState(null);

  const ACTIVE_STAGES=["Exploring","LOI Received","Application Submitted","Appraisal Ordered","Commitment Issued","Closed"];

  const byStage={};
  REFI_STAGES.forEach(s=>byStage[s]=[]);
  en.forEach(l=>{const s=l.refiStatus||"Not Started";(byStage[s]=byStage[s]||[]).push(l);});

  const activePipeline=en.filter(l=>l.refiStatus&&l.refiStatus!=="Not Started"&&l.refiStatus!=="Closed");
  const pipelineBal=activePipeline.reduce((s,l)=>s+l.curBal,0);
  const closedBal=(byStage["Closed"]||[]).reduce((s,l)=>s+l.curBal,0);
  const notStarted=byStage["Not Started"]||[];

  const drop=stageId=>{
    if(!dragging||dragging.refiStatus===stageId)return;
    onSave(dragging.id,{refiStatus:stageId});
    setDragging(null);setDragOver(null);
  };

  return(
    <div>
      {/* Header */}
      <div style={{marginBottom:24}}>
        <div style={{fontSize:22,fontWeight:700,color:"var(--t1)",marginBottom:4}}>Refinancing Pipeline</div>
        <div style={{fontSize:13,color:"var(--t3)"}}>Drag cards between stages to track every active refi. Click any card to open the loan detail.</div>
      </div>

      {/* KPIs */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginBottom:28}}>
        {[
          {lbl:"Active In Pipeline",val:activePipeline.length,sub:f$(pipelineBal)+" in process",c:"blue"},
          {lbl:"Not Yet Started",val:notStarted.length,sub:"may need attention",c:"amber"},
          {lbl:"Closed / Refinanced",val:(byStage["Closed"]||[]).length,sub:f$(closedBal)+" completed",c:"green"},
          {lbl:"Total Pipeline Value",val:f$(pipelineBal+closedBal),sub:"active + closed",c:""},
        ].map((k,i)=>(
          <div key={i} className="scard">
            <div className="sc-lbl">{k.lbl}</div>
            <div className={`sc-val${k.c?" "+k.c:""}`}>{k.val}</div>
            <div className="sc-sub">{k.sub}</div>
          </div>
        ))}
      </div>

      {/* Progress strip showing pipeline flow */}
      <div style={{background:"var(--white)",border:"1px solid var(--bd)",borderRadius:14,padding:"16px 20px",marginBottom:24}}>
        <div style={{fontSize:10,fontWeight:700,color:"var(--t3)",textTransform:"uppercase",letterSpacing:".07em",marginBottom:12}}>Pipeline Stages</div>
        <div style={{display:"flex",alignItems:"center",gap:0}}>
          {ACTIVE_STAGES.map((stage,i)=>{
            const meta=STAGE_META[stage];
            const count=(byStage[stage]||[]).length;
            const isLast=i===ACTIVE_STAGES.length-1;
            return(
              <div key={stage} style={{display:"flex",alignItems:"center",flex:1}}>
                <div style={{
                  flex:1,padding:"10px 12px",borderRadius:8,textAlign:"center",
                  background:count>0?meta.bg:"transparent",
                  border:`1px solid ${count>0?meta.bd:"var(--bd)"}`,
                  position:"relative",
                }}>
                  <div style={{fontSize:12,fontWeight:700,color:count>0?meta.color:"var(--t4)"}}>{count>0?count:"—"}</div>
                  <div style={{fontSize:9,fontWeight:500,color:count>0?meta.color:"var(--t4)",marginTop:1,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{stage}</div>
                  {count>0&&<div style={{fontSize:9,color:meta.color,marginTop:1,opacity:.8}}>{f$((byStage[stage]||[]).reduce((s,l)=>s+l.curBal,0))}</div>}
                </div>
                {!isLast&&<div style={{fontSize:14,color:"var(--bd2)",padding:"0 4px",flexShrink:0}}>›</div>}
              </div>
            );
          })}
        </div>
      </div>

      {/* Kanban board — horizontal scroll */}
      <div style={{overflowX:"auto",marginBottom:28,paddingBottom:4}}>
        <div style={{display:"flex",gap:14,alignItems:"flex-start",minWidth:`${ACTIVE_STAGES.length*240}px`}}>
          {ACTIVE_STAGES.map(stage=>{
            const meta=STAGE_META[stage];
            const cards=byStage[stage]||[];
            const isDragOver=dragOver===stage;
            const stageBal=cards.reduce((s,l)=>s+l.curBal,0);
            return(
              <div key={stage}
                onDragOver={e=>{e.preventDefault();setDragOver(stage);}}
                onDragLeave={e=>{if(!e.currentTarget.contains(e.relatedTarget))setDragOver(null);}}
                onDrop={()=>drop(stage)}
                style={{
                  width:240,flexShrink:0,
                  background:isDragOver?meta.bg:"var(--white)",
                  border:`1.5px solid ${isDragOver?meta.accent:"var(--bd)"}`,
                  borderRadius:14,
                  minHeight:180,
                  transition:"all .18s",
                  overflow:"hidden",
                  boxShadow:isDragOver?`0 0 0 3px ${meta.accent}22`:"0 1px 4px rgba(0,0,0,.04)",
                }}
              >
                {/* Colored accent bar at top */}
                <div style={{height:4,background:meta.accent,borderRadius:"14px 14px 0 0"}}/>

                {/* Column header */}
                <div style={{padding:"14px 14px 10px"}}>
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:4}}>
                    <div style={{display:"flex",alignItems:"center",gap:7}}>
                      <span style={{fontSize:14}}>{meta.icon}</span>
                      <span style={{fontSize:12,fontWeight:700,color:"var(--t1)",lineHeight:1.2}}>{stage}</span>
                    </div>
                    <div style={{
                      fontSize:11,fontWeight:700,
                      minWidth:22,height:22,borderRadius:11,
                      background:cards.length>0?meta.bg:"var(--bg)",
                      color:cards.length>0?meta.color:"var(--t4)",
                      border:`1px solid ${cards.length>0?meta.bd:"var(--bd)"}`,
                      display:"flex",alignItems:"center",justifyContent:"center",
                      padding:"0 7px",
                    }}>{cards.length}</div>
                  </div>
                  {cards.length>0&&(
                    <div style={{fontSize:11,fontWeight:600,color:meta.color}}>{f$(stageBal)}</div>
                  )}
                </div>

                {/* Divider */}
                <div style={{height:1,background:"var(--bd)",margin:"0 14px"}}/>

                {/* Cards */}
                <div style={{padding:"10px 10px 12px",display:"flex",flexDirection:"column",gap:8}}>
                  {cards.map(l=>(
                    <div key={l.id}
                      draggable
                      onDragStart={()=>setDragging(l)}
                      onDragEnd={()=>{setDragging(null);setDragOver(null);}}
                      onClick={()=>onSelect(loans.find(x=>x.id===l.id))}
                      style={{
                        background:"var(--white)",
                        border:`1.5px solid ${dragging?.id===l.id?meta.accent:"var(--bd)"}`,
                        borderRadius:10,
                        padding:"12px 13px",
                        cursor:"grab",
                        transition:"box-shadow .15s,transform .15s,border-color .15s",
                        boxShadow:dragging?.id===l.id?"0 8px 24px rgba(0,0,0,.14)":"0 1px 3px rgba(0,0,0,.05)",
                        transform:dragging?.id===l.id?"rotate(2deg) scale(1.03)":"none",
                        opacity:dragging?.id===l.id?0.55:1,
                        userSelect:"none",
                        position:"relative",
                      }}
                      onMouseEnter={e=>{if(!dragging){e.currentTarget.style.boxShadow="0 4px 14px rgba(0,0,0,.10)";e.currentTarget.style.borderColor=meta.bd;}}}
                      onMouseLeave={e=>{if(!dragging){e.currentTarget.style.boxShadow="0 1px 3px rgba(0,0,0,.05)";e.currentTarget.style.borderColor="var(--bd)";}}}
                    >
                      {/* Status urgency accent */}
                      {(l.status==="urgent"||l.status==="matured")&&(
                        <div style={{position:"absolute",top:0,right:0,width:0,height:0,borderStyle:"solid",borderWidth:"0 20px 20px 0",borderColor:`transparent #dc2626 transparent transparent`,borderRadius:"0 10px 0 0"}}/>
                      )}

                      {/* Address */}
                      <div style={{fontSize:12,fontWeight:700,color:"var(--t1)",lineHeight:1.3,marginBottom:3,paddingRight:16}}>{l.addr}</div>
                      {l.entity&&<div style={{fontSize:10,color:"var(--t3)",marginBottom:8}}>{l.entity}</div>}

                      {/* Balance — prominent */}
                      <div style={{fontSize:16,fontWeight:700,color:"var(--t1)",marginBottom:8,lineHeight:1}}>{f$(l.curBal)}</div>

                      {/* Maturity chip */}
                      <div style={{marginBottom:8}}><MatChip loan={l}/></div>

                      {/* Rate + lender row */}
                      <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:l.activityLog?.length>0?8:0}}>
                        <span style={{
                          fontSize:10,fontWeight:600,padding:"2px 8px",borderRadius:20,
                          background:l.rate>7?"var(--rbg)":l.rate>5?"var(--abg)":"var(--gbg)",
                          color:l.rate>7?"var(--red)":l.rate>5?"var(--amber)":"var(--green)",
                        }}>{fPct(l.rate)}</span>
                        <span style={{fontSize:10,color:"var(--t3)",padding:"2px 0",lineHeight:"20px"}}>{l.loanType}</span>
                      </div>

                      {/* Last activity note */}
                      {l.activityLog?.length>0&&(
                        <div style={{
                          fontSize:10,color:"var(--t3)",
                          borderTop:"1px solid var(--bd)",paddingTop:8,
                          lineHeight:1.4,
                          display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical",overflow:"hidden",
                        }}>
                          💬 {l.activityLog[l.activityLog.length-1].text}
                        </div>
                      )}
                    </div>
                  ))}

                  {cards.length===0&&(
                    <div style={{
                      padding:"24px 12px",textAlign:"center",
                      border:`2px dashed ${isDragOver?meta.accent:"var(--bd)"}`,
                      borderRadius:10,
                      transition:"border-color .15s",
                    }}>
                      <div style={{fontSize:20,marginBottom:6,opacity:.3}}>{meta.icon}</div>
                      <div style={{fontSize:11,color:isDragOver?meta.color:"var(--t4)",fontWeight:isDragOver?600:400}}>
                        {isDragOver?"Drop here":"Empty"}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Not Started pool */}
      {notStarted.length>0&&(
        <div>
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12}}>
            <div style={{fontSize:15,fontWeight:700,color:"var(--t1)"}}>Not Yet Started</div>
            <span style={{
              fontSize:10,fontWeight:600,padding:"2px 10px",borderRadius:20,
              background:"var(--abg)",color:"var(--amber)",border:"1px solid var(--abd)",
            }}>{notStarted.length} loans</span>
            <span style={{fontSize:11,color:"var(--t3)"}}>— drag a row into a column above to begin tracking</span>
          </div>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr><th>Address</th><th>Lender</th><th>Balance</th><th>Rate</th><th>Maturity</th><th>Prepay</th><th>Priority</th></tr>
              </thead>
              <tbody>
                {[...notStarted].sort((a,b)=>a.daysLeft-b.daysLeft).map(l=>{
                  const isUrgent=l.status==="urgent"||l.status==="matured";
                  const isSoon=l.status==="soon";
                  return(
                    <tr key={l.id}
                      draggable
                      onDragStart={()=>setDragging(l)}
                      onDragEnd={()=>{setDragging(null);setDragOver(null);}}
                      onClick={()=>onSelect(loans.find(x=>x.id===l.id))}
                    >
                      <td>
                        <div style={{display:"flex",alignItems:"center",gap:8}}>
                          {isUrgent&&<div style={{width:3,height:32,borderRadius:2,background:"var(--red)",flexShrink:0}}/>}
                          {isSoon&&!isUrgent&&<div style={{width:3,height:32,borderRadius:2,background:"var(--amber)",flexShrink:0}}/>}
                          {!isUrgent&&!isSoon&&<div style={{width:3,height:32,borderRadius:2,background:"var(--bd2)",flexShrink:0}}/>}
                          <div>
                            <div className="td-a">{l.addr}</div>
                            <div className="td-b">{l.entity||l.lenderType}</div>
                          </div>
                        </div>
                      </td>
                      <td><span style={{fontSize:12,color:"var(--t2)"}}>{l.lender}</span></td>
                      <td><span className="td-n">{f$(l.curBal)}</span></td>
                      <td><span className={`td-n${l.rate>7?" red":l.rate>5?" amber":" green"}`}>{fPct(l.rate)}</span></td>
                      <td><MatChip loan={l}/></td>
                      <td><span style={{fontSize:11,color:"var(--t3)"}}>{l.prepay||"None"}</span></td>
                      <td>
                        <span style={{
                          fontSize:10,fontWeight:700,padding:"3px 10px",borderRadius:20,
                          background:isUrgent?"var(--rbg)":isSoon?"var(--abg)":"var(--bg)",
                          color:isUrgent?"var(--red)":isSoon?"var(--amber)":"var(--t3)",
                          border:`1px solid ${isUrgent?"var(--rbd)":isSoon?"var(--abd)":"var(--bd)"}`,
                        }}>
                          {isUrgent?"🔴 High":isSoon?"🟡 Medium":"⚪ Low"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─────────── CASHFLOW IMPACT ─────────── */
function CashflowChart({months, height=180}){
  const [hov,setHov]=useState(null);
  const W=780,H=height,PAD={t:16,r:16,b:40,l:72};
  const cW=W-PAD.l-PAD.r, cH=H-PAD.t-PAD.b;
  const maxDS=Math.max(...months.map(m=>m.totalDS));
  const ticks=[0,.25,.5,.75,1];
  return(
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{display:"block",overflow:"visible"}}>
      <defs>
        <linearGradient id="cf-int" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ef4444" stopOpacity=".85"/>
          <stop offset="100%" stopColor="#dc2626" stopOpacity=".6"/>
        </linearGradient>
        <linearGradient id="cf-pri" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#22c55e" stopOpacity=".85"/>
          <stop offset="100%" stopColor="#16a34a" stopOpacity=".6"/>
        </linearGradient>
      </defs>
      <rect x={PAD.l} y={PAD.t} width={cW} height={cH} fill="#fafafa" rx={4}/>
      {ticks.map(p=>{
        const y=PAD.t+cH*(1-p);
        return <g key={p}>
          <line x1={PAD.l} y1={y} x2={PAD.l+cW} y2={y} stroke={p===0?"#cbd5e1":"#e2e8f0"} strokeWidth={p===0?1.5:1} strokeDasharray={p===0?"":"4 3"}/>
          <text x={PAD.l-8} y={y+4} textAnchor="end" fontSize="9" fill="#94a3b8" fontFamily="Inter,sans-serif">{p>0?`$${(maxDS*p/1000).toFixed(0)}K`:""}</text>
        </g>;
      })}
      {months.map((m,i)=>{
        const bw=Math.max(2,(cW/months.length)-2);
        const x=PAD.l+i*(cW/months.length)+1;
        const intH=Math.max(1,(m.interest/maxDS)*cH);
        const priH=Math.max(0,(m.principal/maxDS)*cH);
        const isHov=hov===i;
        const label=m.label;
        return <g key={i} onMouseEnter={()=>setHov(i)} onMouseLeave={()=>setHov(null)}>
          {/* principal (bottom) */}
          <rect x={x} y={PAD.t+cH-intH-priH} width={bw} height={priH} fill="url(#cf-pri)" rx={priH>3?2:0}/>
          {/* interest (on top) */}
          <rect x={x} y={PAD.t+cH-intH} width={bw} height={intH} fill="url(#cf-int)" rx={2}/>
          {/* x label every 12 */}
          {i%12===0&&<text x={x+bw/2} y={H-6} textAnchor="middle" fontSize="9" fill="#94a3b8" fontFamily="Inter,sans-serif">{label}</text>}
          {/* tooltip */}
          {isHov&&<g style={{pointerEvents:"none"}}>
            <rect x={Math.min(x-30,W-140)} y={PAD.t+cH-intH-priH-52} width={130} height={48} rx={7} fill="#0f172a" opacity={.93}/>
            <text x={Math.min(x-30,W-140)+65} y={PAD.t+cH-intH-priH-38} textAnchor="middle" fontSize="10" fontWeight="700" fill="white" fontFamily="Inter,sans-serif">{label} — ${((m.interest+m.principal)/1000).toFixed(0)}K/mo</text>
            <text x={Math.min(x-30,W-140)+65} y={PAD.t+cH-intH-priH-24} textAnchor="middle" fontSize="9" fill="#94a3b8" fontFamily="Inter,sans-serif">Int ${(m.interest/1000).toFixed(0)}K · Pri ${(m.principal/1000).toFixed(0)}K</text>
          </g>}
        </g>;
      })}
      <line x1={PAD.l} y1={PAD.t} x2={PAD.l} y2={PAD.t+cH} stroke="#e2e8f0" strokeWidth={1}/>
    </svg>
  );
}

function CashflowImpact({loans,onSelect}){
  const en=useMemo(()=>loans.map(enrich),[loans]);
  const [horizon,setHorizon]=useState(60);
  const [rateShock,setRateShock]=useState(0);

  // Build month-by-month cashflow for the next N months
  const months=useMemo(()=>{
    const rows=[];
    for(let m=0;m<horizon;m++){
      const d=new Date(TODAY);d.setMonth(d.getMonth()+m);
      const label=d.toLocaleDateString("en-US",{month:"short",year:"2-digit"});
      let interest=0,principal=0,balloon=0;
      en.forEach(l=>{
        // is loan active this month?
        const loanStart=new Date(l.origDate);
        const loanEnd=new Date(l.maturityDate);
        const cur=new Date(TODAY);cur.setMonth(cur.getMonth()+m);
        if(cur<loanStart||cur>loanEnd)return;
        const elapsed=mosBetween(l.origDate,TODAY_STR)+m;
        const amM=(l.amortYears||l.termYears||1)*12;
        const effectiveRate=l.loanType==="ARM"?l.rate+rateShock:l.rate;
        const mr=effectiveRate/100/12;
        const curBal=l.interestOnly?l.origBalance:Math.max(0,calcBal(l.origBalance,effectiveRate,amM,elapsed));
        const mo_int=curBal*mr;
        const pmt=l.interestOnly?mo_int:calcPmt(l.origBalance,effectiveRate,amM);
        const mo_pri=l.interestOnly?0:Math.max(0,Math.min(pmt-mo_int,curBal));
        interest+=mo_int;
        principal+=mo_pri;
        // balloon: if this is the maturity month
        const matMos=mosBetween(TODAY_STR,l.maturityDate);
        if(m===matMos&&!l.interestOnly){
          balloon+=Math.max(0,calcBal(l.origBalance,effectiveRate,amM,elapsed));
        }
      });
      rows.push({label,month:m,interest,principal,totalDS:interest+principal,balloon});
    }
    return rows;
  },[en,horizon,rateShock]);

  const totalMonthlyDS=months[0]?.totalDS||0;
  const totalAnnualDS=months.slice(0,12).reduce((s,m)=>s+m.totalDS,0);
  const totalInterest=months.reduce((s,m)=>s+m.interest,0);
  const totalPrincipal=months.reduce((s,m)=>s+m.principal,0);
  const balloonMonths=months.filter(m=>m.balloon>0);
  const peakMonth=months.reduce((p,m)=>m.totalDS>p.totalDS?m:p,months[0]||{totalDS:0,label:""});

  const armLoans=en.filter(l=>l.loanType==="ARM");
  const armExposure=armLoans.reduce((s,l)=>s+l.curBal,0);
  const rateShockImpact=armExposure*(rateShock/100/12)*12;

  // Per-loan monthly DS table
  const loanDS=en.map(l=>{
    const amM=(l.amortYears||l.termYears||1)*12;
    const elapsed=mosBetween(l.origDate,TODAY_STR);
    const curBal=l.interestOnly?l.origBalance:Math.max(0,calcBal(l.origBalance,l.rate,amM,elapsed));
    const mr=l.rate/100/12;
    const mo_int=curBal*mr;
    const pmt=l.interestOnly?mo_int:calcPmt(l.origBalance,l.rate,amM);
    const mo_pri=l.interestOnly?0:Math.max(0,pmt-mo_int);
    return{...l,curBal,mo_int,mo_pri,totalDS:mo_int+mo_pri,pct:(mo_int+mo_pri)/totalMonthlyDS*100};
  }).sort((a,b)=>b.totalDS-a.totalDS);

  const maxLoanDS=Math.max(...loanDS.map(l=>l.totalDS));

  return(<div>
    {/* Header */}
    <div style={{marginBottom:24}}>
      <div style={{fontSize:22,fontWeight:700,color:"var(--t1)",marginBottom:4}}>Cashflow Impact</div>
      <div style={{fontSize:13,color:"var(--t3)"}}>Total debt service, interest vs. principal breakdown, balloon exposure, and rate shock analysis.</div>
    </div>

    {/* Controls */}
    <div style={{display:"flex",gap:12,alignItems:"center",marginBottom:20,background:"var(--white)",border:"1px solid var(--bd)",borderRadius:12,padding:"12px 16px"}}>
      <div style={{fontSize:11,fontWeight:700,color:"var(--t3)",textTransform:"uppercase",letterSpacing:".06em"}}>Horizon</div>
      {[12,36,60,120].map(h=>(
        <button key={h} onClick={()=>setHorizon(h)} style={{
          padding:"5px 14px",borderRadius:20,border:"1px solid",fontSize:11,fontWeight:600,cursor:"pointer",
          background:horizon===h?"var(--t1)":"var(--white)",
          color:horizon===h?"var(--white)":"var(--t3)",
          borderColor:horizon===h?"var(--t1)":"var(--bd)",
        }}>{h===12?"1yr":h===36?"3yr":h===60?"5yr":"10yr"}</button>
      ))}
      <div style={{width:1,height:20,background:"var(--bd)",margin:"0 4px"}}/>
      <div style={{fontSize:11,fontWeight:700,color:"var(--t3)",textTransform:"uppercase",letterSpacing:".06em"}}>ARM Rate Shock</div>
      {[0,0.5,1,2].map(r=>(
        <button key={r} onClick={()=>setRateShock(r)} style={{
          padding:"5px 14px",borderRadius:20,border:"1px solid",fontSize:11,fontWeight:600,cursor:"pointer",
          background:rateShock===r?(r===0?"var(--t1)":"#dc2626"):"var(--white)",
          color:rateShock===r?"var(--white)":r===0?"var(--t3)":"var(--red)",
          borderColor:rateShock===r?(r===0?"var(--t1)":"#dc2626"):r===0?"var(--bd)":"var(--rbd)",
        }}>+{r}%</button>
      ))}
      {rateShock>0&&armLoans.length>0&&<div style={{fontSize:11,color:"var(--red)",fontWeight:600}}>⚠ +{f$(rateShockImpact)}/yr on {armLoans.length} ARM loan{armLoans.length>1?"s":""}</div>}
    </div>

    {/* KPI cards */}
    <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:10,marginBottom:20}}>
      {[
        {lbl:"Monthly Debt Service",val:f$(totalMonthlyDS),sub:"current run rate",c:""},
        {lbl:"Annual Debt Service",val:f$(totalAnnualDS),sub:`next 12 months`,c:""},
        {lbl:`Interest Over ${horizon/12<1?horizon+"mo":(horizon/12)+"yr"}`,val:f$(totalInterest),sub:"total interest cost",c:"red"},
        {lbl:`Principal Over ${horizon/12<1?horizon+"mo":(horizon/12)+"yr"}`,val:f$(totalPrincipal),sub:"equity built",c:"green"},
        {lbl:"Balloon Payments",val:balloonMonths.length,sub:balloonMonths.length>0?f$(balloonMonths.reduce((s,m)=>s+m.balloon,0))+" total":"none in period",c:balloonMonths.length>0?"amber":""},
      ].map((k,i)=>(
        <div key={i} style={{background:"var(--white)",border:"1px solid var(--bd)",borderRadius:12,padding:"14px 16px"}}>
          <div style={{fontSize:9,fontWeight:700,color:"var(--t3)",textTransform:"uppercase",letterSpacing:".06em",marginBottom:7}}>{k.lbl}</div>
          <div style={{fontSize:18,fontWeight:700,color:k.c==="red"?"var(--red)":k.c==="green"?"var(--green)":k.c==="amber"?"var(--amber)":"var(--t1)",lineHeight:1,marginBottom:3}}>{k.val}</div>
          <div style={{fontSize:10,color:"var(--t3)"}}>{k.sub}</div>
        </div>
      ))}
    </div>

    {/* Stacked bar chart */}
    <div style={{background:"var(--white)",border:"1px solid var(--bd)",borderRadius:14,padding:"20px 20px 12px",marginBottom:20,boxShadow:"0 1px 4px rgba(0,0,0,.04)"}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14}}>
        <div>
          <div style={{fontSize:14,fontWeight:700,color:"var(--t1)"}}>Monthly Debt Service</div>
          <div style={{fontSize:11,color:"var(--t3)",marginTop:2}}>Interest + principal by month · hover for details</div>
        </div>
        <div style={{display:"flex",gap:14}}>
          {[{c:"#dc2626",l:"Interest"},{c:"#16a34a",l:"Principal"}].map(x=>(
            <div key={x.l} style={{display:"flex",alignItems:"center",gap:5,fontSize:10,color:"var(--t3)"}}>
              <div style={{width:10,height:10,borderRadius:2,background:x.c,opacity:.8}}/>
              {x.l}
            </div>
          ))}
        </div>
      </div>
      <CashflowChart months={months}/>
    </div>

    {/* Two col: balloon schedule + per-loan breakdown */}
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:20}}>
      {/* Balloon payments */}
      <div style={{background:"var(--white)",border:"1px solid var(--bd)",borderRadius:14,padding:"18px 20px"}}>
        <div style={{fontSize:14,fontWeight:700,color:"var(--t1)",marginBottom:4}}>Balloon Payments in Window</div>
        <div style={{fontSize:11,color:"var(--t3)",marginBottom:14}}>{horizon/12<2?horizon+"mo":Math.round(horizon/12)+"yr"} outlook — click to open loan</div>
        {balloonMonths.length===0
          ?<div style={{textAlign:"center",padding:"30px 0"}}>
              <div style={{fontSize:24,opacity:.15,marginBottom:8}}>✅</div>
              <div style={{fontSize:12,color:"var(--t3)"}}>No balloon payments in this window</div>
            </div>
          :balloonMonths.map((m,i)=>{
            const loan=en.find(l=>{const mm=mosBetween(TODAY_STR,l.maturityDate);return mm===m.month;});
            if(!loan)return null;
            const isUrgent=m.month<=6;
            return(
              <div key={i} onClick={()=>onSelect(loans.find(x=>x.id===loan.id))}
                style={{
                  display:"flex",alignItems:"center",gap:12,padding:"12px 14px",marginBottom:8,
                  background:isUrgent?"var(--rbg)":"var(--bg)",
                  border:`1px solid ${isUrgent?"var(--rbd)":"var(--bd)"}`,
                  borderRadius:10,cursor:"pointer",transition:"opacity .15s",
                }}>
                <div style={{flexShrink:0}}>
                  <div style={{fontSize:11,fontWeight:700,color:isUrgent?"var(--red)":"var(--amber)"}}>{m.label}</div>
                  <div style={{fontSize:9,color:"var(--t3)",marginTop:1}}>{m.month} mo away</div>
                </div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:12,fontWeight:700,color:"var(--t1)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{loan.addr}</div>
                  <div style={{fontSize:10,color:"var(--t3)"}}>{loan.lender}</div>
                </div>
                <div style={{textAlign:"right",flexShrink:0}}>
                  <div style={{fontSize:13,fontWeight:700,color:isUrgent?"var(--red)":"var(--t1)"}}>{f$(m.balloon)}</div>
                  <div style={{fontSize:9,color:"var(--t3)"}}>balloon due</div>
                </div>
              </div>
            );
          })}
      </div>

      {/* Per-loan DS breakdown */}
      <div style={{background:"var(--white)",border:"1px solid var(--bd)",borderRadius:14,padding:"18px 20px"}}>
        <div style={{fontSize:14,fontWeight:700,color:"var(--t1)",marginBottom:4}}>Monthly DS by Loan</div>
        <div style={{fontSize:11,color:"var(--t3)",marginBottom:14}}>Current month · click to open</div>
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          {loanDS.map(l=>(
            <div key={l.id} onClick={()=>onSelect(loans.find(x=>x.id===l.id))}
              style={{cursor:"pointer"}}
              onMouseEnter={e=>e.currentTarget.style.opacity=".8"}
              onMouseLeave={e=>e.currentTarget.style.opacity="1"}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:4}}>
                <div style={{fontSize:11,fontWeight:600,color:"var(--t1)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:"60%"}}>{l.addr}</div>
                <div style={{display:"flex",gap:10,alignItems:"baseline",flexShrink:0}}>
                  <span style={{fontSize:10,color:"var(--red)"}}>{f$(l.mo_int)} int</span>
                  <span style={{fontSize:11,fontWeight:700,color:"var(--t1)"}}>{f$(l.totalDS)}</span>
                </div>
              </div>
              {/* Stacked mini bar */}
              <div style={{height:6,borderRadius:3,background:"var(--bd)",overflow:"hidden",display:"flex"}}>
                <div style={{width:`${(l.mo_int/maxLoanDS)*100}%`,background:"#ef4444",opacity:.75,transition:"width .4s"}}/>
                <div style={{width:`${(l.mo_pri/maxLoanDS)*100}%`,background:"#22c55e",opacity:.75,transition:"width .4s"}}/>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>

    {/* Full loan DS table */}
    <div style={{fontSize:14,fontWeight:700,color:"var(--t1)",marginBottom:10}}>Debt Service Detail — All Loans</div>
    <div className="tbl-wrap">
      <table className="tbl">
        <thead><tr><th>Address</th><th>Balance</th><th>Rate</th><th>Monthly Interest</th><th>Monthly Principal</th><th>Total DS / mo</th><th>Annual DS</th><th>% of Portfolio DS</th></tr></thead>
        <tbody>
          {loanDS.map(l=>(
            <tr key={l.id} onClick={()=>onSelect(loans.find(x=>x.id===l.id))}>
              <td><div className="td-a">{l.addr}</div><div className="td-b">{l.entity||l.lenderType}</div></td>
              <td><span className="td-n">{f$(l.curBal)}</span></td>
              <td><span className={`td-n${l.rate>7?" red":l.rate>5?" amber":" green"}`}>{fPct(l.rate)}</span></td>
              <td><span style={{fontSize:12,color:"var(--red)",fontWeight:500}}>{f$(l.mo_int)}</span></td>
              <td><span style={{fontSize:12,color:"var(--green)",fontWeight:500}}>{l.interestOnly?<span style={{color:"var(--t4)"}}>IO</span>:f$(l.mo_pri)}</span></td>
              <td><span style={{fontSize:13,fontWeight:700,color:"var(--t1)"}}>{f$(l.totalDS)}</span></td>
              <td><span className="td-n">{f$(l.totalDS*12)}</span></td>
              <td>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <div style={{width:60,height:5,background:"var(--bd)",borderRadius:3,overflow:"hidden"}}>
                    <div style={{width:`${l.pct}%`,height:5,background:"var(--t1)",borderRadius:3,opacity:.6}}/>
                  </div>
                  <span style={{fontSize:11,color:"var(--t3)"}}>{l.pct.toFixed(1)}%</span>
                </div>
              </td>
            </tr>
          ))}
          {/* Totals row */}
          <tr style={{background:"var(--bg)"}}>
            <td colSpan={3}><span style={{fontSize:12,fontWeight:700,color:"var(--t1)"}}>TOTAL</span></td>
            <td><span style={{fontSize:12,fontWeight:700,color:"var(--red)"}}>{f$(loanDS.reduce((s,l)=>s+l.mo_int,0))}</span></td>
            <td><span style={{fontSize:12,fontWeight:700,color:"var(--green)"}}>{f$(loanDS.reduce((s,l)=>s+l.mo_pri,0))}</span></td>
            <td><span style={{fontSize:14,fontWeight:700,color:"var(--t1)"}}>{f$(totalMonthlyDS)}</span></td>
            <td><span style={{fontSize:12,fontWeight:700,color:"var(--t1)"}}>{f$(totalAnnualDS)}</span></td>
            <td><span style={{fontSize:11,color:"var(--t3)"}}>100%</span></td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>);
}

/* ─────────── CONTACTS & DOCS ─────────── */
const DOC_CATS=["Loan Agreement","Promissory Note","Appraisal","Title Policy","Survey","Environmental","Insurance","Tax Records","Correspondence","Other"];
const CONTACT_ROLES=["Servicer","Broker","Lender Contact","Attorney","Appraiser","Title Company","Insurance Agent","Accountant","Property Manager","Other"];

// Keep old combined view as legacy — replaced by ContactsView + DocumentsView below
function ContactsDocs({loans,onSelect}){
  const [selId,setSelId]=useState(String(loans[0]?.id||""));
  const [contacts,setContacts]=useState({});
  const [docs,setDocs]=useState({});
  const [tab,setTab]=useState("contacts");
  const [showAddContact,setShowAddContact]=useState(false);
  const [showAddDoc,setShowAddDoc]=useState(false);
  const [loaded,setLoaded]=useState(false);

  // New contact form state
  const blankC={role:"Servicer",name:"",company:"",phone:"",email:"",notes:""};
  const [nc,setNc]=useState(blankC);

  // New doc form state
  const blankD={category:"Loan Agreement",name:"",date:"",notes:"",fileData:null,fileName:null,fileSize:null,fileType:null};
  const [nd,setNd]=useState(blankD);
  const [uploading,setUploading]=useState(false);

  const sel=loans.find(l=>String(l.id)===selId);
  const curContacts=contacts[selId]||[];
  const curDocs=docs[selId]||[];

  // Load from storage
  useEffect(()=>{(async()=>{
    try{
      const cr=await supaStorage.get("meridian-contacts");
      const dr=await supaStorage.get("meridian-docs");
      if(cr?.value)setContacts(JSON.parse(cr.value));
      if(dr?.value)setDocs(JSON.parse(dr.value));
    }catch{}
    setLoaded(true);
  })();},[]);

  // Save contacts
  useEffect(()=>{if(!loaded)return;(async()=>{try{await supaStorage.set("meridian-contacts",JSON.stringify(contacts));}catch{}})();},[contacts,loaded]);
  // Save docs (base64 - large)
  useEffect(()=>{if(!loaded)return;(async()=>{try{await supaStorage.set("meridian-docs",JSON.stringify(docs));}catch{}})();},[docs,loaded]);

  const addContact=()=>{
    if(!nc.name)return;
    const entry={...nc,id:Date.now()};
    setContacts(p=>({...p,[selId]:[...(p[selId]||[]),entry]}));
    setNc(blankC);setShowAddContact(false);
  };
  const delContact=id=>setContacts(p=>({...p,[selId]:(p[selId]||[]).filter(c=>c.id!==id)}));

  const handleFile=e=>{
    const file=e.target.files?.[0];
    if(!file)return;
    setUploading(true);
    const reader=new FileReader();
    reader.onload=ev=>{
      setNd(d=>({...d,fileData:ev.target.result,fileName:file.name,fileSize:file.size,fileType:file.type,name:d.name||file.name}));
      setUploading(false);
    };
    reader.readAsDataURL(file);
  };

  const addDoc=()=>{
    if(!nd.name)return;
    const entry={...nd,id:Date.now(),uploaded:TODAY_STR};
    setDocs(p=>({...p,[selId]:[...(p[selId]||[]),entry]}));
    setNd(blankD);setShowAddDoc(false);
  };
  const delDoc=id=>setDocs(p=>({...p,[selId]:(p[selId]||[]).filter(d=>d.id!==id)}));

  const downloadDoc=doc=>{
    if(!doc.fileData)return;
    const a=document.createElement("a");
    a.href=doc.fileData;a.download=doc.fileName||doc.name;a.click();
  };

  const fSize=b=>{if(!b)return"";if(b>1e6)return`${(b/1e6).toFixed(1)}MB`;return`${(b/1000).toFixed(0)}KB`;};
  const fileIcon=t=>{
    if(!t)return"📄";
    if(t.includes("pdf"))return"📕";
    if(t.includes("image"))return"🖼️";
    if(t.includes("word")||t.includes("doc"))return"📝";
    if(t.includes("sheet")||t.includes("excel")||t.includes("csv"))return"📊";
    return"📄";
  };

  // Portfolio-wide stats
  const totalContacts=Object.values(contacts).reduce((s,a)=>s+a.length,0);
  const totalDocs=Object.values(docs).reduce((s,a)=>s+a.length,0);
  const loansWithDocs=Object.keys(docs).filter(k=>(docs[k]||[]).length>0).length;

  return(<div>
    {/* Header */}
    <div style={{marginBottom:20}}>
      <div style={{fontSize:22,fontWeight:700,color:"var(--t1)",marginBottom:4}}>Contacts & Documents</div>
      <div style={{fontSize:13,color:"var(--t3)"}}>Store servicer contacts, brokers, attorneys, and critical loan documents — linked per property.</div>
    </div>

    {/* Portfolio stats */}
    <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:20}}>
      {[
        {lbl:"Total Contacts",val:totalContacts,sub:"across all loans",c:""},
        {lbl:"Total Documents",val:totalDocs,sub:"uploaded files",c:"blue"},
        {lbl:"Loans with Docs",val:`${loansWithDocs}/${loans.length}`,sub:"file coverage",c:loansWithDocs<loans.length?"amber":"green"},
        {lbl:"Loans Missing Docs",val:loans.length-loansWithDocs,sub:"no files uploaded",c:loans.length-loansWithDocs>0?"red":""},
      ].map((k,i)=>(
        <div key={i} style={{background:"var(--white)",border:"1px solid var(--bd)",borderRadius:12,padding:"14px 16px"}}>
          <div style={{fontSize:9,fontWeight:700,color:"var(--t3)",textTransform:"uppercase",letterSpacing:".06em",marginBottom:7}}>{k.lbl}</div>
          <div style={{fontSize:22,fontWeight:700,color:k.c==="red"?"var(--red)":k.c==="green"?"var(--green)":k.c==="amber"?"var(--amber)":k.c==="blue"?"var(--blue)":"var(--t1)",lineHeight:1,marginBottom:3}}>{k.val}</div>
          <div style={{fontSize:10,color:"var(--t3)"}}>{k.sub}</div>
        </div>
      ))}
    </div>

    {/* Layout: loan selector sidebar + content */}
    <div style={{display:"grid",gridTemplateColumns:"240px 1fr",gap:16,alignItems:"start"}}>

      {/* Loan list */}
      <div style={{background:"var(--white)",border:"1px solid var(--bd)",borderRadius:14,overflow:"hidden",position:"sticky",top:0}}>
        <div style={{padding:"12px 14px",borderBottom:"1px solid var(--bd)",fontSize:10,fontWeight:700,color:"var(--t3)",textTransform:"uppercase",letterSpacing:".07em"}}>Select Property</div>
        <div style={{maxHeight:520,overflowY:"auto"}}>
          {loans.map(l=>{
            const cCount=(contacts[String(l.id)]||[]).length;
            const dCount=(docs[String(l.id)]||[]).length;
            const isActive=String(l.id)===selId;
            const el=enrich(l);
            return(
              <div key={l.id} onClick={()=>setSelId(String(l.id))}
                style={{
                  padding:"11px 14px",cursor:"pointer",
                  background:isActive?"var(--bg)":"transparent",
                  borderLeft:`2px solid ${isActive?"var(--t1)":"transparent"}`,
                  borderBottom:"1px solid var(--bd)",
                  transition:"all .1s",
                }}>
                <div style={{fontSize:11,fontWeight:700,color:isActive?"var(--t1)":"var(--t2)",marginBottom:3,lineHeight:1.3}}>{l.addr}</div>
                <div style={{display:"flex",gap:6,alignItems:"center"}}>
                  {cCount>0&&<span style={{fontSize:9,fontWeight:600,padding:"1px 6px",borderRadius:10,background:"var(--bbg)",color:"var(--blue)",border:"1px solid var(--bbd)"}}>👤 {cCount}</span>}
                  {dCount>0&&<span style={{fontSize:9,fontWeight:600,padding:"1px 6px",borderRadius:10,background:"var(--gbg)",color:"var(--green)",border:"1px solid var(--gbd)"}}>📄 {dCount}</span>}
                  {cCount===0&&dCount===0&&<span style={{fontSize:9,color:"var(--t4)"}}>No records</span>}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Content area */}
      <div>
        {sel&&<>
          {/* Property header */}
          <div style={{background:"var(--white)",border:"1px solid var(--bd)",borderRadius:14,padding:"16px 20px",marginBottom:14}}>
            <div style={{fontSize:16,fontWeight:700,color:"var(--t1)",marginBottom:2}}>{sel.addr}</div>
            <div style={{fontSize:11,color:"var(--t3)"}}>{sel.entity||sel.lender} · {fPct(sel.rate)} · matures {fDateS(sel.maturityDate)}</div>
          </div>

          {/* Tabs */}
          <div style={{display:"flex",gap:2,marginBottom:14,background:"var(--white)",borderRadius:10,padding:3,border:"1px solid var(--bd)",width:"fit-content"}}>
            {[["contacts",`👤 Contacts (${curContacts.length})`],["docs",`📄 Documents (${curDocs.length})`]].map(([id,lbl])=>(
              <button key={id} onClick={()=>setTab(id)} style={{padding:"7px 18px",borderRadius:8,border:"none",fontSize:12,fontWeight:tab===id?700:400,background:tab===id?"var(--t1)":"transparent",color:tab===id?"var(--white)":"var(--t3)",cursor:"pointer"}}>
                {lbl}
              </button>
            ))}
          </div>

          {/* CONTACTS TAB */}
          {tab==="contacts"&&<>
            <div style={{display:"flex",justifyContent:"flex-end",marginBottom:12}}>
              <button className="btn-dark" onClick={()=>setShowAddContact(true)}>+ Add Contact</button>
            </div>

            {curContacts.length===0&&!showAddContact&&(
              <div style={{background:"var(--white)",border:"1px solid var(--bd)",borderRadius:14,padding:"48px 24px",textAlign:"center"}}>
                <div style={{fontSize:32,opacity:.15,marginBottom:12}}>👤</div>
                <div style={{fontSize:14,fontWeight:600,color:"var(--t3)",marginBottom:6}}>No contacts for this property</div>
                <div style={{fontSize:12,color:"var(--t4)",marginBottom:16}}>Add servicers, brokers, attorneys, and other key contacts.</div>
                <button className="btn-dark" onClick={()=>setShowAddContact(true)}>+ Add First Contact</button>
              </div>
            )}

            {/* Add contact form */}
            {showAddContact&&(
              <div style={{background:"var(--white)",border:"1px solid var(--bd)",borderRadius:14,padding:"20px",marginBottom:14,boxShadow:"0 4px 16px rgba(0,0,0,.07)"}}>
                <div style={{fontSize:13,fontWeight:700,color:"var(--t1)",marginBottom:14}}>New Contact</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
                  <div>
                    <div className="flbl" style={{display:"block",marginBottom:4}}>Role</div>
                    <select className="finp" value={nc.role} onChange={e=>setNc(p=>({...p,role:e.target.value}))}>
                      {CONTACT_ROLES.map(r=><option key={r}>{r}</option>)}
                    </select>
                  </div>
                  <div>
                    <div className="flbl" style={{display:"block",marginBottom:4}}>Full Name *</div>
                    <input className="finp" placeholder="Jane Smith" value={nc.name} onChange={e=>setNc(p=>({...p,name:e.target.value}))}/>
                  </div>
                  <div>
                    <div className="flbl" style={{display:"block",marginBottom:4}}>Company</div>
                    <input className="finp" placeholder="Arbor Realty" value={nc.company} onChange={e=>setNc(p=>({...p,company:e.target.value}))}/>
                  </div>
                  <div>
                    <div className="flbl" style={{display:"block",marginBottom:4}}>Phone</div>
                    <input className="finp" placeholder="212-555-0100" value={nc.phone} onChange={e=>setNc(p=>({...p,phone:e.target.value}))}/>
                  </div>
                  <div style={{gridColumn:"span 2"}}>
                    <div className="flbl" style={{display:"block",marginBottom:4}}>Email</div>
                    <input className="finp" placeholder="jane@example.com" value={nc.email} onChange={e=>setNc(p=>({...p,email:e.target.value}))}/>
                  </div>
                  <div style={{gridColumn:"span 2"}}>
                    <div className="flbl" style={{display:"block",marginBottom:4}}>Notes</div>
                    <textarea className="notes-ta" rows={2} placeholder="Key notes or context…" value={nc.notes} onChange={e=>setNc(p=>({...p,notes:e.target.value}))}/>
                  </div>
                </div>
                <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
                  <button className="btn-light" onClick={()=>{setShowAddContact(false);setNc(blankC);}}>Cancel</button>
                  <button className="btn-dark" onClick={addContact}>Save Contact</button>
                </div>
              </div>
            )}

            {/* Contact cards */}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
              {curContacts.map(c=>(
                <div key={c.id} style={{background:"var(--white)",border:"1px solid var(--bd)",borderRadius:12,padding:"16px 18px",position:"relative"}}>
                  <button onClick={()=>delContact(c.id)} style={{position:"absolute",top:10,right:10,background:"none",border:"none",cursor:"pointer",fontSize:11,color:"var(--t4)",padding:"2px 5px",borderRadius:4}} title="Remove">✕</button>
                  <div style={{display:"flex",gap:11,alignItems:"flex-start"}}>
                    <div style={{width:36,height:36,borderRadius:"50%",background:"var(--bg)",border:"1px solid var(--bd)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,flexShrink:0}}>
                      {c.role==="Servicer"?"🏦":c.role==="Broker"?"🤝":c.role==="Attorney"?"⚖️":c.role==="Appraiser"?"🏠":c.role==="Insurance Agent"?"🛡️":"👤"}
                    </div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:13,fontWeight:700,color:"var(--t1)",marginBottom:1}}>{c.name}</div>
                      {c.company&&<div style={{fontSize:11,color:"var(--t3)",marginBottom:4}}>{c.company}</div>}
                      <span style={{fontSize:10,fontWeight:600,padding:"2px 8px",borderRadius:20,background:"var(--bbg)",color:"var(--blue)",border:"1px solid var(--bbd)"}}>{c.role}</span>
                      <div style={{marginTop:10,display:"flex",flexDirection:"column",gap:5}}>
                        {c.phone&&<div style={{display:"flex",alignItems:"center",gap:6}}>
                          <span style={{fontSize:11,color:"var(--t3)"}}>📞</span>
                          <a href={`tel:${c.phone}`} style={{fontSize:11,color:"var(--blue)",textDecoration:"none",fontWeight:500}}>{c.phone}</a>
                          <CopyBtn text={c.phone}/>
                        </div>}
                        {c.email&&<div style={{display:"flex",alignItems:"center",gap:6}}>
                          <span style={{fontSize:11,color:"var(--t3)"}}>✉️</span>
                          <a href={`mailto:${c.email}`} style={{fontSize:11,color:"var(--blue)",textDecoration:"none",fontWeight:500,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{c.email}</a>
                          <CopyBtn text={c.email}/>
                        </div>}
                      </div>
                      {c.notes&&<div style={{marginTop:8,fontSize:10,color:"var(--t3)",lineHeight:1.5,borderTop:"1px solid var(--bd)",paddingTop:8}}>{c.notes}</div>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>}

          {/* DOCUMENTS TAB */}
          {tab==="docs"&&<>
            <div style={{display:"flex",justifyContent:"flex-end",marginBottom:12}}>
              <button className="btn-dark" onClick={()=>setShowAddDoc(true)}>+ Upload Document</button>
            </div>

            {curDocs.length===0&&!showAddDoc&&(
              <div style={{background:"var(--white)",border:"2px dashed var(--bd2)",borderRadius:14,padding:"48px 24px",textAlign:"center"}}>
                <div style={{fontSize:32,opacity:.15,marginBottom:12}}>📁</div>
                <div style={{fontSize:14,fontWeight:600,color:"var(--t3)",marginBottom:6}}>No documents uploaded for this property</div>
                <div style={{fontSize:12,color:"var(--t4)",marginBottom:16}}>Upload loan agreements, appraisals, title policies, and more.</div>
                <button className="btn-dark" onClick={()=>setShowAddDoc(true)}>+ Upload First Document</button>
              </div>
            )}

            {/* Upload form */}
            {showAddDoc&&(
              <div style={{background:"var(--white)",border:"1px solid var(--bd)",borderRadius:14,padding:"20px",marginBottom:14,boxShadow:"0 4px 16px rgba(0,0,0,.07)"}}>
                <div style={{fontSize:13,fontWeight:700,color:"var(--t1)",marginBottom:14}}>Upload Document</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
                  <div>
                    <div className="flbl" style={{display:"block",marginBottom:4}}>Category</div>
                    <select className="finp" value={nd.category} onChange={e=>setNd(p=>({...p,category:e.target.value}))}>
                      {DOC_CATS.map(c=><option key={c}>{c}</option>)}
                    </select>
                  </div>
                  <div>
                    <div className="flbl" style={{display:"block",marginBottom:4}}>Document Name *</div>
                    <input className="finp" placeholder="e.g. Loan Agreement 2024" value={nd.name} onChange={e=>setNd(p=>({...p,name:e.target.value}))}/>
                  </div>
                  <div>
                    <div className="flbl" style={{display:"block",marginBottom:4}}>Date</div>
                    <input className="finp" type="date" value={nd.date} onChange={e=>setNd(p=>({...p,date:e.target.value}))}/>
                  </div>
                  <div>
                    <div className="flbl" style={{display:"block",marginBottom:4}}>File</div>
                    <input type="file" onChange={handleFile} accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.png,.jpg,.jpeg,.txt"
                      style={{width:"100%",padding:"6px 0",fontSize:11,color:"var(--t2)"}}/>
                    {uploading&&<div style={{fontSize:10,color:"var(--blue)",marginTop:4}}>Reading file…</div>}
                    {nd.fileName&&!uploading&&<div style={{fontSize:10,color:"var(--green)",marginTop:4}}>✓ {nd.fileName} ({fSize(nd.fileSize)})</div>}
                  </div>
                  <div style={{gridColumn:"span 2"}}>
                    <div className="flbl" style={{display:"block",marginBottom:4}}>Notes</div>
                    <textarea className="notes-ta" rows={2} placeholder="Brief description or key details…" value={nd.notes} onChange={e=>setNd(p=>({...p,notes:e.target.value}))}/>
                  </div>
                </div>
                <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
                  <button className="btn-light" onClick={()=>{setShowAddDoc(false);setNd(blankD);}}>Cancel</button>
                  <button className="btn-dark" onClick={addDoc} disabled={!nd.name||uploading}>{uploading?"Reading…":"Save Document"}</button>
                </div>
              </div>
            )}

            {/* Doc list grouped by category */}
            {(()=>{
              const grouped={};
              curDocs.forEach(d=>{(grouped[d.category]=grouped[d.category]||[]).push(d);});
              return Object.entries(grouped).map(([cat,docs])=>(
                <div key={cat} style={{marginBottom:16}}>
                  <div style={{fontSize:10,fontWeight:700,color:"var(--t3)",textTransform:"uppercase",letterSpacing:".07em",marginBottom:8,paddingLeft:2}}>{cat}</div>
                  <div style={{display:"flex",flexDirection:"column",gap:7}}>
                    {docs.map(d=>(
                      <div key={d.id} style={{background:"var(--white)",border:"1px solid var(--bd)",borderRadius:10,padding:"13px 16px",display:"flex",alignItems:"center",gap:14}}>
                        <div style={{fontSize:24,flexShrink:0,opacity:.8}}>{fileIcon(d.fileType)}</div>
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{fontSize:13,fontWeight:700,color:"var(--t1)",marginBottom:2}}>{d.name}</div>
                          <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}>
                            {d.date&&<span style={{fontSize:10,color:"var(--t3)"}}>{fDateF(d.date)}</span>}
                            {d.fileName&&<span style={{fontSize:10,color:"var(--t4)"}}>· {d.fileName}</span>}
                            {d.fileSize&&<span style={{fontSize:10,color:"var(--t4)"}}>· {fSize(d.fileSize)}</span>}
                            <span style={{fontSize:9,fontWeight:600,padding:"1px 7px",borderRadius:10,background:"var(--bg)",border:"1px solid var(--bd)",color:"var(--t3)"}}>{cat}</span>
                          </div>
                          {d.notes&&<div style={{fontSize:10,color:"var(--t3)",marginTop:5,lineHeight:1.5}}>{d.notes}</div>}
                        </div>
                        <div style={{display:"flex",gap:6,flexShrink:0}}>
                          {d.fileData&&<button onClick={()=>downloadDoc(d)} style={{padding:"5px 12px",background:"var(--bbg)",border:"1px solid var(--bbd)",borderRadius:7,color:"var(--blue)",fontSize:11,fontWeight:600,cursor:"pointer"}}>⬇ Download</button>}
                          <button onClick={()=>delDoc(d.id)} style={{padding:"5px 10px",background:"var(--rbg)",border:"1px solid var(--rbd)",borderRadius:7,color:"var(--red)",fontSize:11,fontWeight:600,cursor:"pointer"}}>✕</button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ));
            })()}
          </>}
        </>}
      </div>
    </div>
  </div>);
}

/* ─────────── MATURITY WALL CHART ─────────── */
function MaturityWallChart({matSummary}){
  const maxBal=Math.max(...matSummary.map(x=>x[1].bal));
  const totalBal=matSummary.reduce((s,[,d])=>s+d.bal,0);
  const n=matSummary.length;
  const W=800,H=240,PAD={t:24,r:24,b:56,l:76};
  const chartW=W-PAD.l-PAD.r,chartH=H-PAD.t-PAD.b;
  const gap=10,barW=(chartW-(n-1)*gap)/n;
  const yTicks=[0,0.25,0.5,0.75,1];
  const getColor=yr=>{
    if(yr<=2026)return{fill:"url(#grad-red)",stroke:"#dc2626",label:"#dc2626"};
    if(yr<=2028)return{fill:"url(#grad-amber)",stroke:"#d97706",label:"#d97706"};
    return{fill:"url(#grad-slate)",stroke:"#64748b",label:"#64748b"};
  };
  return(
  <div style={{marginBottom:28}}>
    <div style={{display:"flex",alignItems:"flex-end",justifyContent:"space-between",marginBottom:14}}>
      <div>
        <div style={{fontSize:15,fontWeight:700,color:"var(--t1)"}}>Maturity Wall</div>
        <div style={{fontSize:11,color:"var(--t3)",marginTop:2}}>{f$(totalBal)} total debt · {n} maturity years</div>
      </div>
      <div style={{display:"flex",gap:14,alignItems:"center"}}>
        {[{c:"#dc2626",l:"2026 — Urgent"},{c:"#d97706",l:"2027–28 — Near-term"},{c:"#64748b",l:"2029+ — Long-term"}].map(item=>(
          <div key={item.c} style={{display:"flex",alignItems:"center",gap:5,fontSize:10,color:"var(--t3)"}}>
            <div style={{width:10,height:10,borderRadius:3,background:item.c,opacity:.8}}/>
            {item.l}
          </div>
        ))}
      </div>
    </div>
    <div style={{background:"var(--white)",border:"1px solid var(--bd)",borderRadius:16,overflow:"visible",boxShadow:"0 1px 6px rgba(0,0,0,.05)"}}>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{display:"block",overflow:"visible"}}>
        <defs>
          <linearGradient id="grad-red" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f87171" stopOpacity="1"/>
            <stop offset="100%" stopColor="#dc2626" stopOpacity="0.9"/>
          </linearGradient>
          <linearGradient id="grad-amber" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#fbbf24" stopOpacity="1"/>
            <stop offset="100%" stopColor="#d97706" stopOpacity="0.9"/>
          </linearGradient>
          <linearGradient id="grad-slate" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#94a3b8" stopOpacity="1"/>
            <stop offset="100%" stopColor="#475569" stopOpacity="0.9"/>
          </linearGradient>
          <filter id="glow-red"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
          <filter id="shadow"><feDropShadow dx="0" dy="3" stdDeviation="4" floodOpacity="0.14"/></filter>
        </defs>

        {/* Background subtle fill for chart area */}
        <rect x={PAD.l} y={PAD.t} width={chartW} height={chartH} fill="#fafafa" rx={4}/>

        {/* Grid lines + Y labels */}
        {yTicks.map(pct=>{
          const y=PAD.t+chartH*(1-pct);
          return(
            <g key={pct}>
              <line x1={PAD.l} y1={y} x2={PAD.l+chartW} y2={y}
                stroke={pct===0?"#cbd5e1":"#e2e8f0"} strokeWidth={pct===0?1.5:1}
                strokeDasharray={pct===0?"":"5 4"}/>
              <text x={PAD.l-10} y={y+4} textAnchor="end" fontSize="10" fill="#94a3b8" fontFamily="'Inter',sans-serif">{f$(maxBal*pct)}</text>
            </g>
          );
        })}

        {/* Bars */}
        {matSummary.map(([y,d],i)=>{
          const yr=parseInt(y);
          const x=PAD.l+i*(barW+gap);
          const bh=Math.max(8,(d.bal/maxBal)*chartH);
          const by=PAD.t+chartH-bh;
          const clr=getColor(yr);
          const isHov=hovered===y;
          const pct=(d.bal/totalBal*100).toFixed(1);
          const hovBg=yr<=2026?"#fff5f5":yr<=2028?"#fffbf0":"#f8fafc";
          return(
            <g key={y} onMouseEnter={()=>setHovered(y)} onMouseLeave={()=>setHovered(null)} style={{cursor:"default"}}>
              {/* Hover column highlight */}
              {isHov&&<rect x={x-5} y={PAD.t} width={barW+10} height={chartH} rx={6} fill={hovBg} opacity={0.9}/>}
              {/* Bar shadow */}
              {isHov&&<rect x={x+2} y={by+4} width={barW} height={bh} rx={6} fill={clr.stroke} opacity={0.15}/>}
              {/* Main bar */}
              <rect x={x} y={by} width={barW} height={bh} rx={6} ry={6}
                fill={clr.fill}
                style={{transition:"all .2s"}}/>
              {/* Bright top strip */}
              <rect x={x} y={by} width={barW} height={5} rx={3} fill="white" opacity={0.25}/>
              {/* Loan count inside bar */}
              {bh>40&&(
                <text x={x+barW/2} y={by+bh-12} textAnchor="middle" fontSize="10" fontWeight="700"
                  fill="white" opacity="0.95" fontFamily="'Inter',sans-serif">
                  {d.count} loan{d.count>1?"s":""}
                </text>
              )}
              {/* Value above bar */}
              <text x={x+barW/2} y={by-7} textAnchor="middle" fontSize="10" fontWeight="700"
                fill={clr.label} fontFamily="'Inter',sans-serif" opacity={isHov?1:0.85}>
                {f$(d.bal)}
              </text>
              {/* Tooltip on hover */}
              {isHov&&(()=>{
                const tx=Math.min(Math.max(x+barW/2,90),W-90);
                const ty=Math.max(by-60,2);
                return(
                  <g style={{pointerEvents:"none"}}>
                    <rect x={tx-60} y={ty} width={120} height={46} rx={8} fill="#0f172a" opacity={0.93}/>
                    <text x={tx} y={ty+16} textAnchor="middle" fontSize="11" fontWeight="700" fill="white" fontFamily="'Inter',sans-serif">{y} — {f$(d.bal)}</text>
                    <text x={tx} y={ty+30} textAnchor="middle" fontSize="10" fill="#94a3b8" fontFamily="'Inter',sans-serif">{d.count} loan{d.count>1?"s":""} · {pct}% of portfolio</text>
                  </g>
                );
              })()}
              {/* X label year */}
              <text x={x+barW/2} y={PAD.t+chartH+18} textAnchor="middle" fontSize="12" fontWeight="700"
                fill={clr.label} fontFamily="'Inter',sans-serif">{y}</text>
              {/* X label loan count */}
              <text x={x+barW/2} y={PAD.t+chartH+33} textAnchor="middle" fontSize="9" fill="#94a3b8" fontFamily="'Inter',sans-serif">
                {d.count} loan{d.count>1?"s":""}
              </text>
            </g>
          );
        })}

        {/* Y-axis line */}
        <line x1={PAD.l} y1={PAD.t} x2={PAD.l} y2={PAD.t+chartH} stroke="#e2e8f0" strokeWidth={1}/>
      </svg>
    </div>
  </div>
  );
}

function MaturityTimeline({loans,onSelect}){
  const en=useMemo(()=>loans.map(enrich),[loans]);
  const TLS=2024,TLE=2033,SPAN=TLE-TLS;
  const todayFrac=(2026+(1/12)-TLS)/SPAN;
  const sorted=[...en].sort((a,b)=>a.daysLeft-b.daysLeft);
  const tb=en.reduce((s,l)=>s+l.curBal,0);
  const yrs=Array.from({length:TLE-TLS+1},(_,i)=>TLS+i);

  const barColor=l=>{
    if(l.loanType==="Bridge")return{bg:"#fef3c7",border:"#fde68a",txt:"#92400e"};
    if(l.status==="matured"||l.status==="urgent")return{bg:"#fef2f2",border:"#fecaca",txt:"#991b1b"};
    if(l.status==="soon")return{bg:"#fffbeb",border:"#fde68a",txt:"#92400e"};
    return{bg:"#f0fdf4",border:"#bbf7d0",txt:"#166534"};
  };
  const dotColor=l=>{
    if(l.loanType==="Bridge")return"#d97706";
    if(l.status==="matured"||l.status==="urgent")return"#dc2626";
    if(l.status==="soon")return"#d97706";
    return"#16a34a";
  };

  function barPos(l){
    const od=l.origDate?new Date(l.origDate):new Date("2020-01-01");
    const md=l.maturityDate?new Date(l.maturityDate):new Date("2030-01-01");
    const os=Math.max(0,(od.getFullYear()+(od.getMonth()/12)-TLS)/SPAN);
    const ms=Math.min(1,(md.getFullYear()+(md.getMonth()/12)-TLS)/SPAN);
    return{left:`${os*100}%`,width:`${Math.max(0.8,(ms-os)*100)}%`};
  }

  // Group maturities by year for summary
  const byYear={};
  en.forEach(l=>{if(!l.maturityDate)return;const y=new Date(l.maturityDate).getFullYear();if(isNaN(y))return;if(!byYear[y])byYear[y]={count:0,bal:0,urgent:0};byYear[y].count++;byYear[y].bal+=l.curBal;if(l.status==="urgent"||l.status==="matured")byYear[y].urgent++;});
  const matSummary=Object.entries(byYear).sort((a,b)=>a[0]-b[0]);

  return(<div>
    <div style={{marginBottom:20}}>
      <div style={{fontSize:22,fontWeight:700,color:"var(--t1)",marginBottom:4}}>Maturity Timeline</div>
      <div style={{fontSize:13,color:"var(--t3)"}}>Visual map of all {loans.length} loans from origination to maturity. Click any bar to open the loan.</div>
    </div>

    {/* Summary row */}
    <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:20}}>
      <div className="scard"><div className="sc-lbl">Past / Urgent</div><div className="sc-val red">{en.filter(l=>l.status==="matured"||l.status==="urgent").length}</div><div className="sc-sub">within 6 months</div></div>
      <div className="scard"><div className="sc-lbl">Maturing ≤12mo</div><div className="sc-val amber">{en.filter(l=>l.status==="soon").length}</div><div className="sc-sub">6–12 months</div></div>
      <div className="scard"><div className="sc-lbl">Long-Term</div><div className="sc-val green">{en.filter(l=>l.status==="ok").length}</div><div className="sc-sub">&gt;12 months</div></div>
      <div className="scard"><div className="sc-lbl">Bridge Loans</div><div className="sc-val amber">{en.filter(l=>l.loanType==="Bridge").length}</div><div className="sc-sub">short-term / IO</div></div>
    </div>

    {/* Maturity wall chart */}
    <MaturityWallChart matSummary={matSummary}/>

    {/* Legend */}
    <div style={{display:"flex",gap:16,marginBottom:10,marginLeft:200}}>
      {[{c:"#dc2626",l:"Urgent / Past"},{c:"#d97706",l:"Within 12mo"},{c:"#16a34a",l:"Long-term"},{c:"#d97706",l:"Bridge",border:"#fde68a"}].map((item,i)=>(
        <div key={i} style={{display:"flex",alignItems:"center",gap:5,fontSize:10,color:"var(--t3)"}}>
          <div style={{width:10,height:10,borderRadius:2,background:item.c,opacity:.6}}/>
          {item.l}
        </div>
      ))}
    </div>

    {/* Year header */}
    <div style={{display:"flex",paddingLeft:200,marginBottom:4,paddingBottom:6,borderBottom:"1px solid var(--bd)"}}>
      {yrs.map(y=>(
        <div key={y} style={{flex:1,fontSize:9,fontWeight:600,color:"var(--t3)",textAlign:"left",letterSpacing:".04em"}}>{y}</div>
      ))}
    </div>

    {/* Bars */}
    <div style={{background:"var(--white)",border:"1px solid var(--bd)",borderRadius:12,overflow:"hidden"}}>
      {sorted.map((l,i)=>{
        const pos=barPos(l);
        const bc=barColor(l);
        const dc=dotColor(l);
        return(
          <div key={l.id}
            onClick={()=>onSelect(loans.find(x=>x.id===l.id))}
            style={{display:"flex",alignItems:"center",height:38,padding:"0 4px",cursor:"pointer",borderBottom:i<sorted.length-1?"1px solid var(--bd)":"none",transition:"background .1s"}}
            onMouseEnter={e=>e.currentTarget.style.background="var(--bg)"}
            onMouseLeave={e=>e.currentTarget.style.background="transparent"}
          >
            {/* Label */}
            <div style={{width:196,flexShrink:0,paddingRight:8}}>
              <div style={{fontSize:10,fontWeight:600,color:"var(--t1)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",display:"flex",alignItems:"center",gap:5}}>
                <div style={{width:6,height:6,borderRadius:"50%",background:dc,flexShrink:0}}/>
                {l.addr}
              </div>
              <div style={{fontSize:9,color:"var(--t3)",marginTop:1,paddingLeft:11}}>{f$(l.curBal)} · {fPct(l.rate)}</div>
            </div>

            {/* Chart area */}
            <div style={{flex:1,position:"relative",height:"100%",display:"flex",alignItems:"center"}}>
              {/* Today line */}
              <div style={{position:"absolute",left:`${todayFrac*100}%`,top:-2,bottom:-2,width:1,background:"#dc2626",opacity:.4,pointerEvents:"none",zIndex:2}}/>
              {/* Bar */}
              <div style={{position:"absolute",...pos,height:22,borderRadius:4,background:bc.bg,border:`1px solid ${bc.border}`,display:"flex",alignItems:"center",padding:"0 6px",overflow:"hidden",zIndex:1}}>
                <div style={{fontSize:8,fontWeight:600,color:bc.txt,whiteSpace:"nowrap",overflow:"hidden"}}>{fDateS(l.maturityDate)}</div>
              </div>
            </div>
          </div>
        );
      })}
    </div>

    {/* "Today" label */}
    <div style={{display:"flex",paddingLeft:200,marginTop:6}}>
      <div style={{position:"relative",flex:1}}>
        <div style={{position:"absolute",left:`${todayFrac*100}%`,transform:"translateX(-50%)",fontSize:9,fontWeight:700,color:"#dc2626",whiteSpace:"nowrap"}}>▲ Today Feb 2026</div>
      </div>
    </div>
  </div>);
}

/* ─────────── LOAN MATURITY SCHEDULE ─────────── */
function LoanMaturitySchedule({loans,onSelect}){
  const en=useMemo(()=>loans.map(enrich),[loans]);
  const [viewMode,setViewMode]=useState("table");
  const [filterYr,setFilterYr]=useState("ALL");
  const [filterStatus,setFilterStatus]=useState("ALL");
  const [filterLender,setFilterLender]=useState("ALL");
  const [sort,setSort]=useState({col:"daysLeft",dir:1});
  const [search,setSearch]=useState("");

  const years=[...new Set(en.filter(l=>l.maturityDate).map(l=>new Date(l.maturityDate).getFullYear()))].sort();
  const lenders=[...new Set(en.map(l=>l.lender).filter(Boolean))].sort();
  const filtered=en.filter(l=>{
    const yr=filterYr==="ALL"||( l.maturityDate && new Date(l.maturityDate).getFullYear()===parseInt(filterYr));
    const st=filterStatus==="ALL"||l.status===filterStatus;
    const ln=filterLender==="ALL"||l.lender===filterLender;
    const sr=!search||l.addr.toLowerCase().includes(search.toLowerCase())||l.lender.toLowerCase().includes(search.toLowerCase());
    return yr&&st&&ln&&sr;
  });
  const sorted=[...filtered].sort((a,b)=>{
    const av=a[sort.col]??Infinity, bv=b[sort.col]??Infinity;
    return(av>bv?1:av<bv?-1:0)*sort.dir;
  });

  const setS=col=>setSort(s=>({col,dir:s.col===col?-s.dir:1}));
  const arrow=col=>sort.col===col?(sort.dir===1?"↑":"↓"):"";

  // Group by year for the visual timeline view
  const byYear={};
  en.forEach(l=>{
    const y=new Date(l.maturityDate).getFullYear();
    if(!byYear[y])byYear[y]={loans:[],totalBal:0};
    byYear[y].loans.push(l);
    byYear[y].totalBal+=l.curBal;
  });

  const totalPortfolio=en.reduce((s,l)=>s+l.curBal,0);

  // Status styling
  const stMeta=s=>({
    matured:{label:"Matured",color:"#dc2626",bg:"#fef2f2",bd:"#fecaca"},
    urgent: {label:"< 6 mo",color:"#dc2626",bg:"#fef2f2",bd:"#fecaca"},
    soon:   {label:"6–12 mo",color:"#d97706",bg:"#fffbeb",bd:"#fde68a"},
    ok:     {label:"12+ mo",color:"#16a34a",bg:"#f0fdf4",bd:"#bbf7d0"},
  }[s]||{label:s,color:"#64748b",bg:"#f8fafc",bd:"#e2e8f0"});

  const urgentCount=en.filter(l=>l.status==="urgent"||l.status==="matured").length;
  const soonCount=en.filter(l=>l.status==="soon").length;
  const okCount=en.filter(l=>l.status==="ok").length;
  const urgentBal=en.filter(l=>l.status==="urgent"||l.status==="matured").reduce((s,l)=>s+l.curBal,0);

  return(<div>
    {/* Header */}
    <div style={{marginBottom:20}}>
      <div style={{fontSize:22,fontWeight:700,color:"var(--t1)",marginBottom:4}}>Loan Maturity Schedule</div>
      <div style={{fontSize:13,color:"var(--t3)"}}>Every loan sorted by maturity date with days remaining, prepay exposure, and action flags.</div>
    </div>

    {/* KPIs */}
    <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:20}}>
      <div style={{background:"var(--white)",border:"2px solid var(--rbd)",borderRadius:12,padding:"14px 16px"}}>
        <div style={{fontSize:9,fontWeight:700,color:"var(--red)",textTransform:"uppercase",letterSpacing:".07em",marginBottom:7}}>🔴 Urgent / Matured</div>
        <div style={{fontSize:26,fontWeight:700,color:"var(--red)",lineHeight:1,marginBottom:4}}>{urgentCount}</div>
        <div style={{fontSize:11,color:"var(--red)",fontWeight:500}}>{f$(urgentBal)} at risk</div>
      </div>
      <div style={{background:"var(--white)",border:"1px solid var(--abd)",borderRadius:12,padding:"14px 16px"}}>
        <div style={{fontSize:9,fontWeight:700,color:"var(--amber)",textTransform:"uppercase",letterSpacing:".07em",marginBottom:7}}>🟡 Maturing Soon</div>
        <div style={{fontSize:26,fontWeight:700,color:"var(--amber)",lineHeight:1,marginBottom:4}}>{soonCount}</div>
        <div style={{fontSize:11,color:"var(--t3)"}}>within 12 months</div>
      </div>
      <div style={{background:"var(--white)",border:"1px solid var(--bd)",borderRadius:12,padding:"14px 16px"}}>
        <div style={{fontSize:9,fontWeight:700,color:"var(--green)",textTransform:"uppercase",letterSpacing:".07em",marginBottom:7}}>✅ Long-term</div>
        <div style={{fontSize:26,fontWeight:700,color:"var(--green)",lineHeight:1,marginBottom:4}}>{okCount}</div>
        <div style={{fontSize:11,color:"var(--t3)"}}>12+ months remaining</div>
      </div>
      <div style={{background:"var(--white)",border:"1px solid var(--bd)",borderRadius:12,padding:"14px 16px"}}>
        <div style={{fontSize:9,fontWeight:700,color:"var(--t3)",textTransform:"uppercase",letterSpacing:".07em",marginBottom:7}}>Total Loan Count</div>
        <div style={{fontSize:26,fontWeight:700,color:"var(--t1)",lineHeight:1,marginBottom:4}}>{en.length}</div>
        <div style={{fontSize:11,color:"var(--t3)"}}>{f$(totalPortfolio)} total balance</div>
      </div>
    </div>

    {/* Controls */}
    <div style={{marginBottom:14,display:"flex",flexDirection:"column",gap:8}}>
      {/* Row 1: search + view toggle + export */}
      <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
        <input className="f-inp" placeholder="Search address or lender…" value={search} onChange={e=>setSearch(e.target.value)} style={{maxWidth:220}}/>
        <div style={{flex:1}}/>
        <button className="btn-light" style={{fontSize:11}} onClick={()=>downloadCSV("maturity-schedule.csv",
          ["Address","Lender","Balance","Rate","Type","Maturity Date","Days Left","Status","Prepay","Refi Status"],
          sorted.map(l=>[l.addr,l.lender,l.curBal.toFixed(0),l.rate,l.loanType,l.maturityDate||"",l.daysLeft!=null?l.daysLeft:"",l.status,l.prepay||"",l.refiStatus||""])
        )}>⬇ Export CSV</button>
        <div style={{display:"flex",gap:2,background:"var(--white)",border:"1px solid var(--bd)",borderRadius:8,padding:2}}>
          {[["table","📋 Table"],["timeline","🗓 Year View"]].map(([id,lbl])=>(
            <button key={id} onClick={()=>setViewMode(id)} style={{
              padding:"5px 14px",borderRadius:6,border:"none",fontSize:11,fontWeight:viewMode===id?700:400,
              background:viewMode===id?"var(--t1)":"transparent",color:viewMode===id?"var(--white)":"var(--t3)",cursor:"pointer",
            }}>{lbl}</button>
          ))}
        </div>
      </div>
      {/* Row 2: filter pills */}
      <div className="frow" style={{flexWrap:"wrap",gap:5}}>
        <span style={{fontSize:10,color:"var(--t3)",alignSelf:"center",fontWeight:600}}>STATUS:</span>
        {[["ALL","All"],["matured","⚫ Matured"],["urgent","🔴 Urgent"],["soon","🟡 Soon"],["ok","✅ Long-term"],["unknown","No Date"]].map(([id,lbl])=>(
          <button key={id} className={`fb${filterStatus===id?" fa":""}`} onClick={()=>setFilterStatus(id)}>{lbl}</button>
        ))}
        <span style={{fontSize:10,color:"var(--t3)",alignSelf:"center",fontWeight:600,marginLeft:8}}>YEAR:</span>
        {["ALL",...years.map(String)].map(y=>(
          <button key={y} className={`fb${filterYr===y?" fa":""}`} onClick={()=>setFilterYr(y)}>{y==="ALL"?"All Years":y}</button>
        ))}
        <span style={{fontSize:10,color:"var(--t3)",alignSelf:"center",fontWeight:600,marginLeft:8}}>SORT:</span>
        {[["daysLeft","Days Left"],["curBal","Balance ↕"],["rate","Rate ↕"],["maturityDate","Maturity Date"],["addr","A–Z"],["lender","Lender"]].map(([k,lbl])=>(
          <button key={k} className={`fb${sort.col===k?" fa":""}`} onClick={()=>setSort(s=>({col:k,dir:s.col===k?-s.dir:1}))}>{lbl}{sort.col===k?(sort.dir===1?" ↑":" ↓"):""}</button>
        ))}
        <span style={{fontSize:10,color:"var(--t3)",alignSelf:"center",fontWeight:600,marginLeft:8}}>LENDER:</span>
        <select style={{fontSize:11,padding:"4px 8px",borderRadius:6,border:"1px solid var(--bd)",background:"var(--white)",color:"var(--t2)",cursor:"pointer"}}
          value={filterLender} onChange={e=>setFilterLender(e.target.value)}>
          <option value="ALL">All Lenders</option>
          {lenders.map(l=><option key={l} value={l}>{l}</option>)}
        </select>
        <span style={{fontSize:10,color:"var(--t4)",alignSelf:"center",marginLeft:8}}>{sorted.length} of {en.length} loans</span>
      </div>
    </div>

    {/* ─── TABLE VIEW ─── */}
    {viewMode==="table"&&<>
      <div style={{fontSize:10,color:"var(--t3)",marginBottom:8,fontWeight:500}}>{sorted.length} loan{sorted.length!==1?"s":""} · click column headers to sort · click row to open</div>
      <div className="tbl-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th onClick={()=>setS("addr")} style={{cursor:"pointer",userSelect:"none"}}>Address {arrow("addr")}</th>
              <th onClick={()=>setS("lender")} style={{cursor:"pointer",userSelect:"none"}}>Lender {arrow("lender")}</th>
              <th onClick={()=>setS("curBal")} style={{cursor:"pointer",userSelect:"none"}}>Balance {arrow("curBal")}</th>
              <th onClick={()=>setS("rate")} style={{cursor:"pointer",userSelect:"none"}}>Rate {arrow("rate")}</th>
              <th onClick={()=>setS("maturityDate")} style={{cursor:"pointer",userSelect:"none"}}>Maturity Date {arrow("maturityDate")}</th>
              <th onClick={()=>setS("daysLeft")} style={{cursor:"pointer",userSelect:"none"}}>Days Left {arrow("daysLeft")}</th>
              <th>Status</th>
              <th>Prepay</th>
              <th>Refi Status</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((l,i)=>{
              const m=stMeta(l.status);
              const isUrgent=l.status==="urgent"||l.status==="matured";
              return(
                <tr key={l.id} onClick={()=>onSelect(loans.find(x=>x.id===l.id))}
                  style={{background:isUrgent?"var(--rbg)":i%2===0?"var(--white)":"var(--bg)"}}>
                  <td>
                    <div style={{display:"flex",alignItems:"center",gap:8}}>
                      {isUrgent&&<div style={{width:3,height:36,borderRadius:2,background:"var(--red)",flexShrink:0}}/>}
                      <div>
                        <div className="td-a">{l.addr}</div>
                        <div className="td-b">{l.entity||"—"}</div>
                      </div>
                    </div>
                  </td>
                  <td><span style={{fontSize:12,color:"var(--t2)"}}>{l.lender}</span></td>
                  <td><span className="td-n">{f$(l.curBal)}</span></td>
                  <td><span className={`td-n${l.rate>7?" red":l.rate>5?" amber":" green"}`}>{fPct(l.rate)}</span></td>
                  <td>
                    <div style={{fontSize:12,fontWeight:600,color:"var(--t1)"}}>{fDateF(l.maturityDate)}</div>
                    <div style={{fontSize:10,color:"var(--t3)",marginTop:1}}>{new Date(l.maturityDate).getFullYear()}</div>
                  </td>
                  <td>
                    <div style={{
                      fontSize:16,fontWeight:700,
                      color:l.daysLeft<0?"var(--red)":l.daysLeft<180?"var(--red)":l.daysLeft<365?"var(--amber)":"var(--t1)",
                    }}>
                      {l.daysLeft<0?`${Math.abs(l.daysLeft)}d over`:l.daysLeft!=null?`${l.daysLeft}d`:""}
                    </div>
                    <div style={{fontSize:9,color:"var(--t3)",marginTop:1}}>
                      {l.daysLeft!=null?`${Math.abs(Math.round(l.daysLeft/30))} mo ${l.daysLeft<0?"past":"left"}`:""}
                    </div>
                  </td>
                  <td>
                    <span style={{
                      display:"inline-block",padding:"3px 10px",borderRadius:20,fontSize:10,fontWeight:700,
                      background:m.bg,color:m.color,border:`1px solid ${m.bd}`,
                    }}>{m.label}</span>
                  </td>
                  <td><span style={{fontSize:11,color:"var(--t3)",maxWidth:120,display:"inline-block"}}>{l.prepay||"None"}</span></td>
                  <td>
                    {(()=>{
                      const rs=l.refiStatus||"Not Started";
                      const rc=rs==="Closed"?"var(--green)":rs==="Not Started"?"var(--t4)":"var(--blue)";
                      return<span style={{fontSize:10,color:rc,fontWeight:600}}>{rs}</span>;
                    })()}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>}

    {/* ─── YEAR VIEW ─── */}
    {viewMode==="timeline"&&(
      <div style={{display:"flex",flexDirection:"column",gap:16}}>
        {Object.entries(byYear).filter(([y])=>filterYr==="ALL"||y===filterYr).sort(([a],[b])=>a-b).map(([year,data])=>{
          const yr=parseInt(year);
          const isNow=yr===2026;
          const isPast=yr<2026;
          const pct=(data.totalBal/totalPortfolio*100).toFixed(1);
          const yMeta=isPast?{accent:"#dc2626",bg:"var(--rbg)",bd:"var(--rbd)"}:
                       isNow?{accent:"#dc2626",bg:"var(--rbg)",bd:"var(--rbd)"}:
                       yr===2027||yr===2028?{accent:"#d97706",bg:"var(--abg)",bd:"var(--abd)"}:
                       {accent:"#16a34a",bg:"var(--gbg)",bd:"var(--gbd)"};
          return(
            <div key={year} style={{border:`1px solid ${yMeta.bd}`,borderRadius:14,overflow:"hidden",boxShadow:"0 1px 4px rgba(0,0,0,.04)"}}>
              {/* Year header */}
              <div style={{
                padding:"14px 20px",background:yMeta.bg,
                borderBottom:`1px solid ${yMeta.bd}`,
                display:"flex",alignItems:"center",justifyContent:"space-between",
              }}>
                <div style={{display:"flex",alignItems:"center",gap:14}}>
                  <div style={{width:4,height:36,borderRadius:2,background:yMeta.accent,flexShrink:0}}/>
                  <div>
                    <div style={{fontSize:20,fontWeight:800,color:yMeta.accent,lineHeight:1}}>{year}</div>
                    <div style={{fontSize:11,color:"var(--t3)",marginTop:2}}>{data.loans.length} loan{data.loans.length>1?"s":""} maturing</div>
                  </div>
                </div>
                <div style={{textAlign:"right"}}>
                  <div style={{fontSize:18,fontWeight:700,color:"var(--t1)"}}>{f$(data.totalBal)}</div>
                  <div style={{fontSize:10,color:"var(--t3)",marginTop:1}}>{pct}% of portfolio · due this year</div>
                  {/* Mini bar */}
                  <div style={{width:140,height:4,borderRadius:2,background:"var(--bd2)",marginTop:6,marginLeft:"auto"}}>
                    <div style={{width:`${Math.min(100,parseFloat(pct))}%`,height:4,borderRadius:2,background:yMeta.accent}}/>
                  </div>
                </div>
              </div>
              {/* Loan rows */}
              <div style={{background:"var(--white)"}}>
                {data.loans.sort((a,b)=>a.daysLeft-b.daysLeft).map((l,i)=>{
                  const m=stMeta(l.status);
                  const isLast=i===data.loans.length-1;
                  return(
                    <div key={l.id} onClick={()=>onSelect(loans.find(x=>x.id===l.id))}
                      style={{
                        display:"flex",alignItems:"center",gap:16,
                        padding:"14px 20px",
                        borderBottom:isLast?"none":"1px solid var(--bd)",
                        cursor:"pointer",transition:"background .1s",
                      }}
                      onMouseEnter={e=>e.currentTarget.style.background="var(--bg)"}
                      onMouseLeave={e=>e.currentTarget.style.background="var(--white)"}
                    >
                      {/* Status dot */}
                      <div style={{width:10,height:10,borderRadius:"50%",background:m.color,flexShrink:0}}/>
                      {/* Address */}
                      <div style={{flex:2,minWidth:0}}>
                        <div style={{fontSize:13,fontWeight:700,color:"var(--t1)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{l.addr}</div>
                        <div style={{fontSize:10,color:"var(--t3)",marginTop:1}}>{l.entity||l.lender}</div>
                      </div>
                      {/* Maturity date */}
                      <div style={{flex:1,textAlign:"center"}}>
                        <div style={{fontSize:12,fontWeight:600,color:"var(--t1)"}}>{fDateF(l.maturityDate)}</div>
                        <div style={{fontSize:10,color:m.color,fontWeight:600,marginTop:1}}>
                          {l.daysLeft<0?`${Math.abs(l.daysLeft)}d overdue`:`${l.daysLeft} days`}
                        </div>
                      </div>
                      {/* Balance */}
                      <div style={{flex:1,textAlign:"right"}}>
                        <div style={{fontSize:14,fontWeight:700,color:"var(--t1)"}}>{f$(l.curBal)}</div>
                        <div style={{fontSize:10,color:"var(--t3)",marginTop:1}}>{fPct(l.rate)} {l.loanType}</div>
                      </div>
                      {/* Status pill */}
                      <div style={{flexShrink:0}}>
                        <span style={{display:"inline-block",padding:"4px 12px",borderRadius:20,fontSize:10,fontWeight:700,background:m.bg,color:m.color,border:`1px solid ${m.bd}`}}>{m.label}</span>
                      </div>
                      {/* Refi status */}
                      <div style={{flexShrink:0,width:100,textAlign:"right"}}>
                        {(()=>{
                          const rs=l.refiStatus||"Not Started";
                          const rc=rs==="Closed"?"var(--green)":rs==="Not Started"?"var(--t4)":"var(--blue)";
                          return<span style={{fontSize:10,color:rc,fontWeight:600}}>{rs}</span>;
                        })()}
                      </div>
                      <div style={{fontSize:12,color:"var(--t4)",flexShrink:0}}>›</div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    )}
  </div>);
}

/* ─────────── LENDER EXPOSURE ─────────── */
function LenderExposure({loans,onSelect}){
  const en=useMemo(()=>loans.map(enrich),[loans]);
  const tb=en.reduce((s,l)=>s+l.curBal,0);

  // By lender
  const byLender={};
  en.forEach(l=>{
    if(!byLender[l.lender])byLender[l.lender]={lender:l.lender,type:l.lenderType,bal:0,count:0,rate:0,loans:[],urgent:0,recourse:0};
    byLender[l.lender].bal+=l.curBal;
    byLender[l.lender].count+=1;
    byLender[l.lender].rate+=l.rate*l.curBal;
    byLender[l.lender].loans.push(l);
    if(l.status==="urgent"||l.status==="matured")byLender[l.lender].urgent+=1;
    if(l.recourse)byLender[l.lender].recourse+=1;
  });
  const lenders=Object.values(byLender).map(r=>({...r,wac:r.rate/r.bal,pct:r.bal/tb*100})).sort((a,b)=>b.bal-a.bal);

  // By lender type
  const byType={};
  en.forEach(l=>{
    if(!byType[l.lenderType])byType[l.lenderType]={type:l.lenderType,bal:0,count:0,rate:0};
    byType[l.lenderType].bal+=l.curBal;
    byType[l.lenderType].count+=1;
    byType[l.lenderType].rate+=l.rate*l.curBal;
  });
  const types=Object.values(byType).map(r=>({...r,wac:r.rate/r.bal,pct:r.bal/tb*100})).sort((a,b)=>b.bal-a.bal);

  // Recourse exposure
  const recBal=en.filter(l=>l.recourse).reduce((s,l)=>s+l.curBal,0);
  const nrBal=en.filter(l=>!l.recourse).reduce((s,l)=>s+l.curBal,0);

  // Maturity concentration
  const byYear={};
  en.forEach(l=>{const y=new Date(l.maturityDate).getFullYear();if(!byYear[y])byYear[y]=0;byYear[y]+=l.curBal;});
  const matYears=Object.entries(byYear).map(([y,b])=>({year:y,bal:b,pct:b/tb*100})).sort((a,b)=>a.year-b.year);
  const maxYrBal=Math.max(...matYears.map(r=>r.bal));

  // Top lender concentration risk
  const topLender=lenders[0];
  const conc=topLender?.pct||0;

  const typeColors={"Agency":"var(--green)","Regional Bank":"var(--blue)","National Bank":"var(--amber)","Life Company":"var(--t1)","Bridge":"var(--red)","Special Servicer":"var(--amber)","CMBS":"var(--blue)","Private / Hard Money":"var(--red)"};

  return(<div>
    <div style={{marginBottom:20}}>
      <div style={{fontSize:22,fontWeight:700,color:"var(--t1)",marginBottom:4}}>Lender Exposure</div>
      <div style={{fontSize:13,color:"var(--t3)"}}>Concentration risk, recourse breakdown, and maturity schedule by lender.</div>
    </div>

    {/* KPI strip */}
    <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:20}}>
      <div className="scard"><div className="sc-lbl">Total Lenders</div><div className="sc-val">{lenders.length}</div><div className="sc-sub">across {loans.length} loans</div></div>
      <div className="scard"><div className="sc-lbl">Top Lender Concentration</div><div className={`sc-val${conc>40?" red":conc>25?" amber":""}`}>{conc.toFixed(1)}%</div><div className="sc-sub">{topLender?.lender}</div></div>
      <div className="scard"><div className="sc-lbl">Recourse Exposure</div><div className="sc-val amber">{f$(recBal)}</div><div className="sc-sub">{(recBal/tb*100).toFixed(1)}% of portfolio</div></div>
      <div className="scard"><div className="sc-lbl">Non-Recourse</div><div className="sc-val green">{f$(nrBal)}</div><div className="sc-sub">{(nrBal/tb*100).toFixed(1)}% of portfolio</div></div>
    </div>

    {conc>30&&<div className="warn-box" style={{marginBottom:16}}>⚠ {topLender?.lender} holds {conc.toFixed(1)}% of total portfolio debt — high concentration risk. Diversify at next refi opportunity.</div>}

    {/* By Lender table */}
    <div style={{marginBottom:20}}>
      <div className="sec-hdr"><div className="sec-t">Exposure by Lender</div><div className="sec-m">SORTED BY BALANCE</div></div>
      <div className="tbl-wrap">
        <table className="tbl">
          <thead><tr><th>Lender</th><th>Type</th><th>Loans</th><th>Balance</th><th>% of Portfolio</th><th>Wtd. Rate</th><th>Recourse</th><th>Urgent</th></tr></thead>
          <tbody>{lenders.map((r,i)=>(
            <tr key={r.lender} style={{cursor:"default"}}>
              <td>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <div style={{width:3,height:32,borderRadius:2,background:typeColors[r.type]||"var(--t3)",flexShrink:0}}/>
                  <div>
                    <div className="td-a">{r.lender}</div>
                    <div className="td-b">{r.count} loan{r.count>1?"s":""}</div>
                  </div>
                </div>
              </td>
              <td><span className="chip chip-grey">{r.type}</span></td>
              <td><span className="td-n">{r.count}</span></td>
              <td><span className="td-n">{f$(r.bal)}</span></td>
              <td>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <div style={{width:80,height:6,background:"var(--bd)",borderRadius:3,overflow:"hidden"}}>
                    <div style={{height:6,borderRadius:3,background:i===0?"var(--amber)":"var(--t1)",width:`${r.pct}%`}}/>
                  </div>
                  <span className={`td-n${r.pct>30?" amber":""}`}>{r.pct.toFixed(1)}%</span>
                </div>
              </td>
              <td><span className={`td-n${r.wac>7?" red":r.wac>5?" amber":" green"}`}>{fPct(r.wac)}</span></td>
              <td><span className={`td-n${r.recourse>0?" amber":""}`}>{r.recourse} / {r.count}</span></td>
              <td>{r.urgent>0?<span className="chip chip-red">{r.urgent} urgent</span>:<span className="td-n muted">—</span>}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </div>

    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:20}}>
      {/* By type */}
      <div>
        <div className="sec-hdr"><div className="sec-t">By Lender Type</div></div>
        <div style={{background:"var(--white)",border:"1px solid var(--bd)",borderRadius:12,padding:"16px 18px"}}>
          {types.map(r=>(
            <div key={r.type} style={{marginBottom:14}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:5}}>
                <div style={{display:"flex",alignItems:"center",gap:7}}>
                  <div style={{width:8,height:8,borderRadius:2,background:typeColors[r.type]||"var(--t3)"}}/>
                  <span style={{fontSize:12,fontWeight:600,color:"var(--t1)"}}>{r.type}</span>
                  <span style={{fontSize:10,color:"var(--t3)"}}>{r.count} loan{r.count>1?"s":""}</span>
                </div>
                <div style={{textAlign:"right"}}>
                  <span style={{fontSize:13,fontWeight:700,color:"var(--t1)"}}>{f$(r.bal)}</span>
                  <span style={{fontSize:10,color:"var(--t3)",marginLeft:6}}>{r.pct.toFixed(1)}%</span>
                </div>
              </div>
              <div style={{height:6,background:"var(--bd)",borderRadius:3,overflow:"hidden"}}>
                <div style={{height:6,borderRadius:3,background:typeColors[r.type]||"var(--t3)",width:`${r.pct}%`}}/>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Maturity by year */}
      <div>
        <div className="sec-hdr"><div className="sec-t">Maturity Schedule</div><div className="sec-m">DEBT DUE BY YEAR</div></div>
        <div style={{background:"var(--white)",border:"1px solid var(--bd)",borderRadius:12,padding:"16px 18px"}}>
          {matYears.map(r=>{
            const isUrgent=parseInt(r.year)<=2026;
            return(
            <div key={r.year} style={{marginBottom:12}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:4}}>
                <span style={{fontSize:12,fontWeight:600,color:isUrgent?"var(--red)":"var(--t1)"}}>{r.year}</span>
                <div style={{textAlign:"right"}}>
                  <span style={{fontSize:13,fontWeight:700,color:isUrgent?"var(--red)":"var(--t1)"}}>{f$(r.bal)}</span>
                  <span style={{fontSize:10,color:"var(--t3)",marginLeft:6}}>{r.pct.toFixed(1)}%</span>
                </div>
              </div>
              <div style={{height:6,background:"var(--bd)",borderRadius:3,overflow:"hidden"}}>
                <div style={{height:6,borderRadius:3,background:isUrgent?"var(--red)":"var(--t1)",width:`${(r.bal/maxYrBal)*100}%`}}/>
              </div>
            </div>
          );})}
        </div>
      </div>
    </div>

    {/* Loan-level detail per lender */}
    <div className="sec-hdr"><div className="sec-t">All Loans by Lender</div><div className="sec-m">CLICK TO OPEN</div></div>
    {lenders.map(r=>(
      <div key={r.lender} style={{marginBottom:12}}>
        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
          <div style={{width:3,height:16,borderRadius:2,background:typeColors[r.type]||"var(--t3)"}}/>
          <span style={{fontSize:13,fontWeight:700,color:"var(--t1)"}}>{r.lender}</span>
          <span className="chip chip-grey">{r.type}</span>
          <span style={{fontSize:11,color:"var(--t3)",marginLeft:4}}>{f$(r.bal)} · {r.pct.toFixed(1)}% of portfolio</span>
        </div>
        <div className="tbl-wrap" style={{marginBottom:4}}>
          <table className="tbl">
            <thead><tr><th>Address</th><th>Balance</th><th>Rate</th><th>Maturity</th><th>Recourse</th><th>DSCR</th><th>Refi</th></tr></thead>
            <tbody>{r.loans.map(l=>(
              <tr key={l.id} onClick={()=>onSelect(loans.find(x=>x.id===l.id))}>
                <td><div className="td-a">{l.addr}</div><div className="td-b">{l.entity||"—"}</div></td>
                <td><span className="td-n">{f$(l.curBal)}</span></td>
                <td><span className={`td-n${l.rate>7?" red":l.rate>5?" amber":" green"}`}>{fPct(l.rate)}</span></td>
                <td><MatChip loan={l}/></td>
                <td><span className={`td-n${l.recourse?" amber":" green"}`}>{l.recourse?"Recourse":"NR"}</span></td>
                <td><span className={`td-n${l.dscr&&l.dscrCovenant&&l.dscr<l.dscrCovenant?" red":!l.dscr?" muted":l.dscr>1.3?" green":" amber"}`}>{l.dscr?l.dscr.toFixed(2)+"x":"—"}</span></td>
                <td><RefiChip status={l.refiStatus}/></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </div>
    ))}
  </div>);
}

/* ─────────── NOI & DSCR TRACKER ─────────── */
function NOIDSCRTracker({loans,onSelect}){
  const [noILog,setNoiLog]=useState({});
  const [loaded,setLoaded]=useState(false);
  const [selId,setSelId]=useState(String(loans[0]?.id||""));
  const [form,setForm]=useState({date:"",noi:"",notes:""});
  const [adding,setAdding]=useState(false);

  useEffect(()=>{(async()=>{try{const r=await supaStorage.get("meridian-noi");if(r?.value)setNoiLog(JSON.parse(r.value));}catch{}setLoaded(true);})();},[]);
  useEffect(()=>{if(!loaded)return;(async()=>{try{await supaStorage.set("meridian-noi",JSON.stringify(noILog));}catch{}})();},[noILog,loaded]);

  const sel=loans.find(l=>String(l.id)===selId);
  const en=sel?enrich(sel):null;
  const entries=(noILog[selId]||[]).slice().sort((a,b)=>b.date.localeCompare(a.date));

  const addEntry=()=>{
    if(!form.date||!form.noi)return;
    const entry={id:Date.now(),date:form.date,noi:parseFloat(form.noi),notes:form.notes};
    setNoiLog(p=>({...p,[selId]:[...(p[selId]||[]),entry]}));
    setForm({date:"",noi:"",notes:""});setAdding(false);
  };
  const delEntry=id=>setNoiLog(p=>({...p,[selId]:(p[selId]||[]).filter(e=>e.id!==id)}));

  // Build chart data from entries
  const chartEntries=[...entries].reverse().slice(-8);
  const maxNoi=Math.max(...chartEntries.map(e=>e.noi),1);

  // Per-entry DSCR
  const annualDS=en?en.pmt*12:0;
  const dscrForNoi=noi=>annualDS>0?(noi/annualDS).toFixed(2)+"x":"—";
  const covenant=sel?.dscrCovenant;

  // Portfolio summary — all loans with covenants
  const allWithCov=loans.filter(l=>l.dscrCovenant).map(l=>{
    const el=enrich(l);
    const latestEntry=(noILog[String(l.id)]||[]).sort((a,b)=>b.date.localeCompare(a.date))[0];
    const latestNoi=latestEntry?.noi||l.annualNOI;
    const dscr=latestNoi&&el.pmt>0?latestNoi/(el.pmt*12):null;
    const gap=dscr&&l.dscrCovenant?((dscr-l.dscrCovenant)/l.dscrCovenant*100):null;
    return{...l,el,latestNoi,dscr,gap,latestDate:latestEntry?.date};
  });

  if(loans.length===0)return(<div style={{padding:"64px 40px",textAlign:"center"}}>
    <div style={{fontSize:32,opacity:.2,marginBottom:12}}>📊</div>
    <div style={{fontSize:16,fontWeight:700,color:"var(--t3)"}}>No loans yet — add loans to track NOI and DSCR.</div>
  </div>);

  return(<div>
    <div style={{marginBottom:20}}>
      <div style={{fontSize:22,fontWeight:700,color:"var(--t1)",marginBottom:4}}>NOI & DSCR Tracker</div>
      <div style={{fontSize:13,color:"var(--t3)"}}>Log quarterly NOI for each property, track DSCR trends, and monitor covenant headroom over time.</div>
    </div>

    {/* Portfolio DSCR summary table */}
    {allWithCov.length>0&&<>
      <div style={{fontSize:13,fontWeight:700,color:"var(--t1)",marginBottom:10}}>Portfolio Covenant Overview</div>
      <div style={{background:"var(--white)",border:"1px solid var(--bd)",borderRadius:14,marginBottom:24,overflow:"hidden"}}>
        <table className="tbl">
          <thead><tr><th>Property</th><th>Latest NOI</th><th>Annual DS</th><th>DSCR</th><th>Covenant</th><th>Headroom</th><th>Last Updated</th></tr></thead>
          <tbody>{allWithCov.sort((a,b)=>(a.gap??99)-(b.gap??99)).map(l=>{
            const status=!l.dscr?"unknown":l.dscr<l.dscrCovenant?"breach":l.gap<10?"warning":"ok";
            const stC={breach:"var(--red)",warning:"var(--amber)",ok:"var(--green)",unknown:"var(--t4)"}[status];
            return(<tr key={l.id} onClick={()=>{setSelId(String(l.id));}} style={{cursor:"pointer",background:status==="breach"?"var(--rbg)":status==="warning"?"var(--abg)":""}}>
              <td><div className="td-a">{l.addr}</div><div className="td-b">{l.lender}</div></td>
              <td><span className="td-n">{l.latestNoi?f$(l.latestNoi):"—"}</span></td>
              <td><span className="td-n">{f$(l.el.annualDS)}</span></td>
              <td><span className="td-n" style={{color:stC,fontSize:15}}>{l.dscr?l.dscr.toFixed(2)+"x":"—"}</span></td>
              <td><span className="td-n">{l.dscrCovenant}x</span></td>
              <td>
                {l.gap!=null?<>
                  <div style={{width:80,height:6,background:"var(--bd)",borderRadius:3,overflow:"hidden",marginBottom:2}}>
                    <div style={{width:`${Math.min(100,Math.max(0,l.gap+10))}%`,height:6,background:stC,borderRadius:3}}/>
                  </div>
                  <div style={{fontSize:10,color:stC,fontWeight:600}}>{l.gap>=0?"+":""}{l.gap.toFixed(1)}%</div>
                </>:<span style={{color:"var(--t4)",fontSize:11}}>No data</span>}
              </td>
              <td><span style={{fontSize:11,color:"var(--t3)"}}>{l.latestDate||"Never"}</span></td>
            </tr>);
          })}</tbody>
        </table>
      </div>
    </>}

    {/* Per-loan NOI log */}
    <div style={{display:"grid",gridTemplateColumns:"220px 1fr",gap:16,alignItems:"start"}}>
      {/* Loan selector */}
      <div style={{background:"var(--white)",border:"1px solid var(--bd)",borderRadius:12,overflow:"hidden",position:"sticky",top:0}}>
        <div style={{padding:"10px 14px",borderBottom:"1px solid var(--bd)",fontSize:10,fontWeight:700,color:"var(--t3)",textTransform:"uppercase",letterSpacing:".07em"}}>Property</div>
        <div style={{maxHeight:460,overflowY:"auto"}}>
          {loans.map(l=>{
            const cnt=(noILog[String(l.id)]||[]).length;
            const isActive=String(l.id)===selId;
            return(<div key={l.id} onClick={()=>setSelId(String(l.id))}
              style={{padding:"10px 14px",cursor:"pointer",background:isActive?"var(--bg)":"transparent",borderLeft:`2px solid ${isActive?"var(--t1)":"transparent"}`,borderBottom:"1px solid var(--bd)"}}>
              <div style={{fontSize:11,fontWeight:700,color:isActive?"var(--t1)":"var(--t2)",marginBottom:2}}>{l.addr}</div>
              <div style={{fontSize:10,color:"var(--t3)"}}>{cnt>0?`${cnt} entries`:"No entries yet"}</div>
            </div>);
          })}
        </div>
      </div>

      {/* Log + chart */}
      <div>
        {sel&&<>
          {/* Property header */}
          <div style={{background:"var(--white)",border:"1px solid var(--bd)",borderRadius:12,padding:"14px 18px",marginBottom:12,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div>
              <div style={{fontSize:15,fontWeight:700,color:"var(--t1)"}}>{sel.addr}</div>
              <div style={{fontSize:11,color:"var(--t3)"}}>Monthly DS: {f$(en?.pmt)} · Annual DS: {f$(en?.annualDS)} {covenant?`· Covenant: ${covenant}x`:""}</div>
            </div>
            <button className="btn-dark" onClick={()=>setAdding(true)}>+ Log NOI</button>
          </div>

          {/* Add form */}
          {adding&&<div style={{background:"var(--white)",border:"1px solid var(--bd)",borderRadius:12,padding:"16px 18px",marginBottom:12,boxShadow:"0 4px 12px rgba(0,0,0,.07)"}}>
            <div style={{fontSize:13,fontWeight:700,color:"var(--t1)",marginBottom:12}}>Log NOI Entry</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
              <div><div className="flbl" style={{display:"block",marginBottom:3}}>Period (YYYY-MM)</div><input className="finp" type="month" value={form.date} onChange={e=>setForm(p=>({...p,date:e.target.value}))}/></div>
              <div><div className="flbl" style={{display:"block",marginBottom:3}}>Annual NOI ($) *</div><input className="finp" type="number" placeholder="480000" value={form.noi} onChange={e=>setForm(p=>({...p,noi:e.target.value}))}/></div>
              <div style={{gridColumn:"span 2"}}><div className="flbl" style={{display:"block",marginBottom:3}}>Notes</div><input className="finp" placeholder="Vacancy increased, new lease signed, etc." value={form.notes} onChange={e=>setForm(p=>({...p,notes:e.target.value}))}/></div>
            </div>
            <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
              <button className="btn-light" onClick={()=>{setAdding(false);setForm({date:"",noi:"",notes:""});}}>Cancel</button>
              <button className="btn-dark" onClick={addEntry}>Save Entry</button>
            </div>
          </div>}

          {/* Mini bar chart */}
          {chartEntries.length>1&&<div style={{background:"var(--white)",border:"1px solid var(--bd)",borderRadius:12,padding:"16px 18px",marginBottom:12}}>
            <div style={{fontSize:11,fontWeight:700,color:"var(--t2)",marginBottom:12}}>NOI Trend — Last {chartEntries.length} periods</div>
            <div style={{display:"flex",gap:6,alignItems:"flex-end",height:80}}>
              {chartEntries.map((e,i)=>{
                const h=Math.max(8,Math.round((e.noi/maxNoi)*72));
                const dscr=annualDS>0?e.noi/annualDS:null;
                const c=!dscr?"var(--t4)":dscr<(covenant||1.2)?"var(--red)":dscr<(covenant||1.2)*1.1?"var(--amber)":"var(--green)";
                return(<div key={e.id} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:3}}>
                  <div style={{fontSize:9,color:"var(--t4)",textAlign:"center"}}>{f$(e.noi)}</div>
                  <div style={{width:"100%",height:h,background:c,borderRadius:4,opacity:.8}}/>
                  <div style={{fontSize:8,color:"var(--t4)",textAlign:"center",lineHeight:1.2}}>{e.date.slice(0,7)}</div>
                </div>);
              })}
            </div>
            {annualDS>0&&<div style={{height:2,background:"var(--bd2)",marginTop:6,position:"relative"}}>
              <div style={{position:"absolute",right:0,top:-10,fontSize:8,color:"var(--t3)"}}>DS line: {f$(annualDS)}/yr</div>
            </div>}
          </div>}

          {/* Entry list */}
          {entries.length===0?<div style={{background:"var(--white)",border:"2px dashed var(--bd2)",borderRadius:12,padding:"40px 24px",textAlign:"center"}}>
            <div style={{fontSize:28,opacity:.15,marginBottom:8}}>📊</div>
            <div style={{fontSize:13,fontWeight:600,color:"var(--t3)"}}>No NOI entries yet for this property</div>
            <div style={{fontSize:11,color:"var(--t4)",marginTop:4}}>Log quarterly NOI to track DSCR over time.</div>
          </div>:<div style={{display:"flex",flexDirection:"column",gap:8}}>
            {entries.map(e=>{
              const dscr=annualDS>0?(e.noi/annualDS):null;
              const ok=!covenant||!dscr||dscr>=covenant;
              const warn=covenant&&dscr&&dscr>=covenant&&dscr<covenant*1.1;
              return(<div key={e.id} style={{background:"var(--white)",border:`1px solid ${!ok?"var(--rbd)":warn?"var(--abd)":"var(--bd)"}`,borderRadius:10,padding:"13px 16px",display:"flex",alignItems:"center",gap:16}}>
                <div style={{width:4,height:40,borderRadius:2,background:!ok?"var(--red)":warn?"var(--amber)":"var(--green)",flexShrink:0}}/>
                <div style={{flex:1}}>
                  <div style={{fontSize:12,fontWeight:700,color:"var(--t1)"}}>{e.date}</div>
                  {e.notes&&<div style={{fontSize:11,color:"var(--t3)",marginTop:2}}>{e.notes}</div>}
                </div>
                <div style={{textAlign:"right"}}>
                  <div style={{fontSize:16,fontWeight:700,color:"var(--t1)"}}>{f$(e.noi)}<span style={{fontSize:10,color:"var(--t3)",fontWeight:400}}>/yr</span></div>
                  {dscr&&<div style={{fontSize:12,fontWeight:700,color:!ok?"var(--red)":warn?"var(--amber)":"var(--green)"}}>{dscr.toFixed(2)}x DSCR</div>}
                </div>
                <button onClick={()=>delEntry(e.id)} style={{background:"none",border:"none",cursor:"pointer",fontSize:12,color:"var(--t4)",padding:"2px 6px"}}>✕</button>
              </div>);
            })}
          </div>}
        </>}
      </div>
    </div>
  </div>);
}

/* ─────────── COVENANT MONITOR ─────────── */
function CovenantMonitor({loans,onSelect}){
  const [noILog,setNoiLog]=useState({});
  const [loaded,setLoaded]=useState(false);
  useEffect(()=>{(async()=>{try{const r=await supaStorage.get("meridian-noi");if(r?.value)setNoiLog(JSON.parse(r.value));}catch{}setLoaded(true);})();},[]);

  const withCov=useMemo(()=>loans.filter(l=>l.dscrCovenant).map(l=>{
    const el=enrich(l);
    const hist=(noILog[String(l.id)]||[]).sort((a,b)=>b.date.localeCompare(a.date));
    const latestNoi=hist[0]?.noi||l.annualNOI;
    const dscr=latestNoi&&el.pmt>0?latestNoi/(el.pmt*12):null;
    const headroom=dscr&&l.dscrCovenant?((dscr-l.dscrCovenant)/l.dscrCovenant*100):null;
    const status=!dscr?"unknown":dscr<l.dscrCovenant?"breach":headroom<10?"warning":headroom<25?"caution":"ok";
    const trend=hist.length>=2?(()=>{const a=hist[0].noi/(el.pmt*12),b=hist[1].noi/(el.pmt*12);return a>b?"up":a<b?"down":"flat";})():"unknown";
    return{...l,el,latestNoi,dscr,headroom,status,trend,hist};
  }),[loans,noILog]);

  const breaches=withCov.filter(l=>l.status==="breach");
  const warnings=withCov.filter(l=>l.status==="warning");
  const cautions=withCov.filter(l=>l.status==="caution");
  const healthy=withCov.filter(l=>l.status==="ok");
  const noData=withCov.filter(l=>l.status==="unknown");

  const statusStyle={
    breach:{bg:"var(--rbg)",bd:"var(--rbd)",c:"var(--red)",label:"BREACH",icon:"🔴"},
    warning:{bg:"#fff8e1",bd:"var(--abd)",c:"var(--amber)",label:"WARNING",icon:"⚠️"},
    caution:{bg:"#fffbeb",bd:"#fde68a",c:"#b45309",label:"CAUTION",icon:"🟡"},
    ok:{bg:"var(--gbg)",bd:"var(--gbd)",c:"var(--green)",label:"HEALTHY",icon:"✅"},
    unknown:{bg:"var(--bg)",bd:"var(--bd)",c:"var(--t4)",label:"NO DATA",icon:"❓"},
  };

  const LoanCard=({l})=>{
    const ss=statusStyle[l.status];
    return(<div onClick={()=>onSelect(loans.find(x=>x.id===l.id))}
      style={{background:ss.bg,border:`1px solid ${ss.bd}`,borderRadius:12,padding:"16px 18px",cursor:"pointer",transition:"transform .1s,box-shadow .1s"}}
      onMouseEnter={e=>{e.currentTarget.style.transform="translateY(-1px)";e.currentTarget.style.boxShadow="0 4px 12px rgba(0,0,0,.08)";}}
      onMouseLeave={e=>{e.currentTarget.style.transform="";e.currentTarget.style.boxShadow="";}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10}}>
        <div>
          <div style={{fontSize:12,fontWeight:700,color:"var(--t1)",marginBottom:2}}>{l.addr}</div>
          <div style={{fontSize:10,color:"var(--t3)"}}>{l.lender} · {fPct(l.rate)} {l.loanType}</div>
        </div>
        <span style={{fontSize:9,fontWeight:800,padding:"3px 10px",borderRadius:20,background:ss.c,color:"#fff",letterSpacing:".06em"}}>{ss.icon} {ss.label}</span>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:10}}>
        {[
          {l:"DSCR",v:l.dscr?l.dscr.toFixed(2)+"x":"—",c:ss.c},
          {l:"Covenant",v:l.dscrCovenant+"x",c:"var(--t2)"},
          {l:"Headroom",v:l.headroom!=null?(l.headroom>=0?"+":"")+l.headroom.toFixed(1)+"%":"—",c:l.headroom!=null&&l.headroom<0?"var(--red)":l.headroom<10?"var(--amber)":"var(--green)"},
        ].map((k,i)=><div key={i} style={{background:"rgba(255,255,255,.6)",borderRadius:8,padding:"8px 10px"}}>
          <div style={{fontSize:8,fontWeight:700,color:"var(--t3)",textTransform:"uppercase",letterSpacing:".06em",marginBottom:3}}>{k.l}</div>
          <div style={{fontSize:14,fontWeight:700,color:k.c}}>{k.v}</div>
        </div>)}
      </div>
      {/* Mini trend */}
      {l.hist.length>1&&<div style={{display:"flex",gap:3,alignItems:"flex-end",height:28,marginBottom:6}}>
        {l.hist.slice(0,6).reverse().map((e,i)=>{
          const d=e.noi/(l.el.pmt*12);
          const h=Math.max(4,Math.round((d/Math.max(...l.hist.map(x=>x.noi/(l.el.pmt*12))))*24));
          return(<div key={i} style={{flex:1,height:h,borderRadius:2,background:d<l.dscrCovenant?"var(--red)":d<l.dscrCovenant*1.1?"var(--amber)":"var(--green)",opacity:.7}}/>);
        })}
        <div style={{fontSize:9,color:"var(--t3)",marginLeft:4,whiteSpace:"nowrap"}}>DSCR trend {l.trend==="up"?"↑":l.trend==="down"?"↓":"→"}</div>
      </div>}
      <div style={{display:"flex",justifyContent:"space-between",fontSize:10,color:"var(--t3)"}}>
        <span>NOI: {l.latestNoi?f$(l.latestNoi):"Not logged"}</span>
        <span>DS: {f$(l.el.annualDS)}/yr</span>
        <span>Matures: {fDateS(l.maturityDate)}</span>
      </div>
    </div>);
  };

  if(withCov.length===0)return(<div style={{padding:"64px 40px",textAlign:"center"}}>
    <div style={{fontSize:32,opacity:.2,marginBottom:12}}>🛡️</div>
    <div style={{fontSize:16,fontWeight:700,color:"var(--t3)",marginBottom:6}}>No loans with DSCR covenants found</div>
    <div style={{fontSize:12,color:"var(--t4)"}}>Add a DSCR Covenant value when editing a loan to enable monitoring.</div>
  </div>);

  return(<div>
    <div style={{marginBottom:20}}>
      <div style={{fontSize:22,fontWeight:700,color:"var(--t1)",marginBottom:4}}>Covenant Monitor</div>
      <div style={{fontSize:13,color:"var(--t3)"}}>{withCov.length} loans with DSCR covenants · Click any card to open loan detail</div>
    </div>

    {/* Summary KPIs */}
    <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:24}}>
      {[
        {l:"Covenant Breaches",v:breaches.length,c:"var(--red)",bg:"var(--rbg)",bd:"var(--rbd)"},
        {l:"Within 10% of Breach",v:warnings.length,c:"var(--amber)",bg:"#fffbeb",bd:"var(--abd)"},
        {l:"Caution (10–25%)",v:cautions.length,c:"#b45309",bg:"#fffbeb",bd:"#fde68a"},
        {l:"Healthy",v:healthy.length,c:"var(--green)",bg:"var(--gbg)",bd:"var(--gbd)"},
      ].map((k,i)=><div key={i} style={{background:k.bg,border:`1px solid ${k.bd}`,borderRadius:12,padding:"14px 16px"}}>
        <div style={{fontSize:9,fontWeight:700,color:k.c,textTransform:"uppercase",letterSpacing:".07em",marginBottom:6}}>{k.l}</div>
        <div style={{fontSize:28,fontWeight:800,color:k.c,lineHeight:1}}>{k.v}</div>
      </div>)}
    </div>

    {/* Cards by status group */}
    {[
      {label:"🔴 Covenant Breaches — Immediate Action Required",items:breaches},
      {label:"⚠️ Within 10% of Covenant — Monitor Closely",items:warnings},
      {label:"🟡 Caution Zone (10–25% headroom)",items:cautions},
      {label:"✅ Healthy Coverage",items:healthy},
      {label:"❓ No NOI Data Logged",items:noData},
    ].filter(g=>g.items.length>0).map(g=>(
      <div key={g.label} style={{marginBottom:24}}>
        <div style={{fontSize:12,fontWeight:700,color:"var(--t2)",marginBottom:10}}>{g.label}</div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:10}}>
          {g.items.map(l=><LoanCard key={l.id} l={l}/>)}
        </div>
      </div>
    ))}
  </div>);
}

/* ─────────── RATE CAP TRACKER ─────────── */
function RateCapTracker({loans,onSelect}){
  const [sofr,setSofr]=useState("5.33");

  const armLoans=useMemo(()=>loans.filter(l=>l.loanType==="ARM"||l.loanType==="SOFR").map(l=>{
    const el=enrich(l);
    const hasCap=!!(l.capRate&&l.capExpiry);
    const daysToCapExpiry=l.capExpiry?daysTo(l.capExpiry):null;
    const daysToMaturity=el.daysLeft;
    const capExpiresBeforeMaturity=hasCap&&daysToCapExpiry<daysToMaturity;
    const currentSOFR=parseFloat(sofr)||0;
    const spread=Math.max(0,l.rate-currentSOFR); // estimated loan spread
    const rateAtCap=hasCap?l.capRate:null;
    const pmtAtCap=hasCap?calcPmt(el.curBal,rateAtCap,Math.max(1,(l.amortYears||l.termYears||1)*12-mosBetween(l.origDate||TODAY_STR,TODAY_STR))):null;
    const pmtAtSofr500=calcPmt(el.curBal,currentSOFR+spread+2,Math.max(1,(l.amortYears||l.termYears||1)*12-mosBetween(l.origDate||TODAY_STR,TODAY_STR)));
    const urgency=!hasCap?"no-cap":daysToCapExpiry<0?"expired":daysToCapExpiry<90?"critical":daysToCapExpiry<180?"urgent":daysToCapExpiry<365?"soon":"ok";
    return{...l,el,hasCap,daysToCapExpiry,capExpiresBeforeMaturity,rateAtCap,pmtAtCap,pmtAtSofr500,urgency,spread};
  }),[loans,sofr]);

  const noCapLoans=armLoans.filter(l=>!l.hasCap);
  const expiredCaps=armLoans.filter(l=>l.hasCap&&l.urgency==="expired");
  const criticalCaps=armLoans.filter(l=>l.urgency==="critical");
  const urgentCaps=armLoans.filter(l=>l.urgency==="urgent");
  const soonCaps=armLoans.filter(l=>l.urgency==="soon");
  const okCaps=armLoans.filter(l=>l.urgency==="ok");

  const urgStyle={
    "no-cap":{c:"var(--red)",bg:"var(--rbg)",bd:"var(--rbd)",label:"NO CAP"},
    "expired":{c:"var(--red)",bg:"var(--rbg)",bd:"var(--rbd)",label:"EXPIRED"},
    "critical":{c:"var(--red)",bg:"var(--rbg)",bd:"var(--rbd)",label:"< 90 DAYS"},
    "urgent":{c:"var(--amber)",bg:"#fffbeb",bd:"var(--abd)",label:"< 6 MO"},
    "soon":{c:"#b45309",bg:"#fffbeb",bd:"#fde68a",label:"< 12 MO"},
    "ok":{c:"var(--green)",bg:"var(--gbg)",bd:"var(--gbd)",label:"OK"},
  };

  if(armLoans.length===0)return(<div style={{padding:"64px 40px",textAlign:"center"}}>
    <div style={{fontSize:32,opacity:.2,marginBottom:12}}>📉</div>
    <div style={{fontSize:16,fontWeight:700,color:"var(--t3)"}}>No ARM or SOFR loans in your portfolio.</div>
  </div>);

  const totalArmBal=armLoans.reduce((s,l)=>s+l.el.curBal,0);
  const unprotectedBal=[...noCapLoans,...expiredCaps].reduce((s,l)=>s+l.el.curBal,0);

  return(<div>
    <div style={{marginBottom:20}}>
      <div style={{fontSize:22,fontWeight:700,color:"var(--t1)",marginBottom:4}}>Rate Cap Tracker</div>
      <div style={{fontSize:13,color:"var(--t3)"}}>Monitor all ARM & SOFR rate caps, expiry dates, and unprotected rate exposure.</div>
    </div>

    {/* SOFR input + summary */}
    <div style={{display:"grid",gridTemplateColumns:"auto 1fr",gap:12,marginBottom:20,alignItems:"stretch"}}>
      <div style={{background:"var(--white)",border:"2px solid var(--blue)",borderRadius:14,padding:"16px 20px",display:"flex",alignItems:"center",gap:16}}>
        <div>
          <div style={{fontSize:10,fontWeight:700,color:"var(--blue)",textTransform:"uppercase",letterSpacing:".08em",marginBottom:4}}>Current SOFR (%)</div>
          <div style={{fontSize:11,color:"var(--t3)",marginBottom:8}}>Update to live rate for accurate modeling</div>
        </div>
        <input type="number" step="0.01" value={sofr} onChange={e=>setSofr(e.target.value)}
          style={{width:90,padding:"10px 12px",border:"2px solid var(--blue)",borderRadius:9,fontSize:20,fontWeight:800,color:"var(--blue)",textAlign:"center",outline:"none"}}/>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10}}>
        {[
          {l:"ARM / SOFR Loans",v:armLoans.length,c:"var(--blue)",bg:"var(--bbg)",bd:"var(--bbd)"},
          {l:"Total ARM Exposure",v:f$(totalArmBal),c:"var(--t1)",bg:"var(--white)",bd:"var(--bd)"},
          {l:"Unprotected Balance",v:f$(unprotectedBal),c:unprotectedBal>0?"var(--red)":"var(--green)",bg:unprotectedBal>0?"var(--rbg)":"var(--gbg)",bd:unprotectedBal>0?"var(--rbd)":"var(--gbd)"},
          {l:"Caps Expiring < 1yr",v:criticalCaps.length+urgentCaps.length+soonCaps.length,c:"var(--amber)",bg:"#fffbeb",bd:"var(--abd)"},
        ].map((k,i)=><div key={i} style={{background:k.bg,border:`1px solid ${k.bd}`,borderRadius:12,padding:"14px 16px"}}>
          <div style={{fontSize:9,fontWeight:700,color:k.c,textTransform:"uppercase",letterSpacing:".07em",marginBottom:6}}>{k.l}</div>
          <div style={{fontSize:22,fontWeight:800,color:k.c,lineHeight:1}}>{k.v}</div>
        </div>)}
      </div>
    </div>

    {/* Loan cards */}
    {[
      {label:"🔴 No Cap / Expired — Fully Exposed",items:[...noCapLoans,...expiredCaps]},
      {label:"🚨 Critical — Cap Expires < 90 Days",items:criticalCaps},
      {label:"⚠️ Urgent — Cap Expires < 6 Months",items:urgentCaps},
      {label:"🕐 Soon — Cap Expires < 12 Months",items:soonCaps},
      {label:"✅ Protected — Cap OK",items:okCaps},
    ].filter(g=>g.items.length>0).map(g=>(
      <div key={g.label} style={{marginBottom:20}}>
        <div style={{fontSize:12,fontWeight:700,color:"var(--t2)",marginBottom:10}}>{g.label}</div>
        <div style={{display:"flex",flexDirection:"column",gap:8}}>
          {g.items.map(l=>{
            const ss=urgStyle[l.urgency];
            return(<div key={l.id} onClick={()=>onSelect(loans.find(x=>x.id===l.id))}
              style={{background:ss.bg,border:`1px solid ${ss.bd}`,borderRadius:12,padding:"15px 18px",cursor:"pointer",display:"flex",alignItems:"center",gap:16}}>
              <div style={{flex:2,minWidth:0}}>
                <div style={{fontSize:13,fontWeight:700,color:"var(--t1)",marginBottom:2}}>{l.addr}</div>
                <div style={{fontSize:10,color:"var(--t3)"}}>{l.lender} · {l.loanType} @ {fPct(l.rate)}</div>
              </div>
              <div style={{flex:1,textAlign:"center"}}>
                <div style={{fontSize:9,fontWeight:700,color:"var(--t3)",textTransform:"uppercase",letterSpacing:".06em",marginBottom:2}}>Cap Strike</div>
                <div style={{fontSize:15,fontWeight:700,color:ss.c}}>{l.capRate?fPct(l.capRate):"None"}</div>
              </div>
              <div style={{flex:1,textAlign:"center"}}>
                <div style={{fontSize:9,fontWeight:700,color:"var(--t3)",textTransform:"uppercase",letterSpacing:".06em",marginBottom:2}}>Cap Provider</div>
                <div style={{fontSize:12,fontWeight:600,color:"var(--t2)"}}>{l.capProvider||"—"}</div>
              </div>
              <div style={{flex:1,textAlign:"center"}}>
                <div style={{fontSize:9,fontWeight:700,color:"var(--t3)",textTransform:"uppercase",letterSpacing:".06em",marginBottom:2}}>Cap Expiry</div>
                <div style={{fontSize:12,fontWeight:700,color:ss.c}}>{l.capExpiry?fDateS(l.capExpiry):"—"}</div>
                {l.daysToCapExpiry!=null&&<div style={{fontSize:10,color:ss.c,fontWeight:600}}>{l.daysToCapExpiry<0?`${Math.abs(l.daysToCapExpiry)}d expired`:`${l.daysToCapExpiry}d left`}</div>}
              </div>
              <div style={{flex:1,textAlign:"center"}}>
                <div style={{fontSize:9,fontWeight:700,color:"var(--t3)",textTransform:"uppercase",letterSpacing:".06em",marginBottom:2}}>Loan Matures</div>
                <div style={{fontSize:12,fontWeight:600,color:"var(--t2)"}}>{fDateS(l.maturityDate)}</div>
              </div>
              <div style={{flex:1,textAlign:"center"}}>
                <div style={{fontSize:9,fontWeight:700,color:"var(--t3)",textTransform:"uppercase",letterSpacing:".06em",marginBottom:2}}>Balance</div>
                <div style={{fontSize:13,fontWeight:700,color:"var(--t1)"}}>{f$(l.el.curBal)}</div>
              </div>
              <span style={{fontSize:9,fontWeight:800,padding:"4px 12px",borderRadius:20,background:ss.c,color:"#fff",letterSpacing:".06em",flexShrink:0}}>{ss.label}</span>
            </div>);
          })}
        </div>
      </div>
    ))}
  </div>);
}

/* ─────────── LENDER CRM ─────────── */
function LenderCRM({loans,onSelect}){
  const [notes,setNotes]=useState({});
  const [loaded,setLoaded]=useState(false);
  const [selLender,setSelLender]=useState(null);
  const [newNote,setNewNote]=useState("");
  const [noteType,setNoteType]=useState("call");

  useEffect(()=>{(async()=>{try{const r=await supaStorage.get("meridian-lender-crm");if(r?.value)setNotes(JSON.parse(r.value));}catch{}setLoaded(true);})();},[]);
  useEffect(()=>{if(!loaded)return;(async()=>{try{await supaStorage.set("meridian-lender-crm",JSON.stringify(notes));}catch{}})();},[notes,loaded]);

  // Group loans by lender
  const lenderMap=useMemo(()=>{
    const m={};
    loans.forEach(l=>{
      const k=l.lender||"Unknown";
      if(!m[k])m[k]={loans:[],totalBal:0,servicerName:l.servicerName,servicerPhone:l.servicerPhone,servicerEmail:l.servicerEmail};
      m[k].loans.push(l);
      m[k].totalBal+=enrich(l).curBal;
    });
    return m;
  },[loans]);

  const lenders=Object.entries(lenderMap).sort((a,b)=>b[1].totalBal-a[1].totalBal);
  const totalPort=loans.map(enrich).reduce((s,l)=>s+l.curBal,0);

  const addNote=()=>{
    if(!newNote.trim()||!selLender)return;
    const entry={id:Date.now(),type:noteType,text:newNote.trim(),date:TODAY_STR};
    setNotes(p=>({...p,[selLender]:[...(p[selLender]||[]),entry]}));
    setNewNote("");
  };
  const delNote=(lender,id)=>setNotes(p=>({...p,[lender]:(p[lender]||[]).filter(n=>n.id!==id)}));

  const urgencyForLender=ldata=>{
    const en=ldata.loans.map(enrich);
    if(en.some(l=>l.status==="matured"||l.status==="urgent"))return"red";
    if(en.some(l=>l.status==="soon"))return"amber";
    return"green";
  };

  if(loans.length===0)return(<div style={{padding:"64px 40px",textAlign:"center"}}>
    <div style={{fontSize:32,opacity:.2,marginBottom:12}}>🏦</div>
    <div style={{fontSize:16,fontWeight:700,color:"var(--t3)"}}>No loans yet. Add loans to build your lender CRM.</div>
  </div>);

  const LD=lenderMap[selLender];

  return(<div>
    <div style={{marginBottom:20}}>
      <div style={{fontSize:22,fontWeight:700,color:"var(--t1)",marginBottom:4}}>Lender Relationships</div>
      <div style={{fontSize:13,color:"var(--t3)"}}>{lenders.length} lenders · Track relationships, log calls, and manage exposure by institution.</div>
    </div>

    <div style={{display:"grid",gridTemplateColumns:"260px 1fr",gap:16,alignItems:"start"}}>
      {/* Lender list */}
      <div style={{background:"var(--white)",border:"1px solid var(--bd)",borderRadius:14,overflow:"hidden",position:"sticky",top:0}}>
        <div style={{padding:"10px 14px",borderBottom:"1px solid var(--bd)",fontSize:10,fontWeight:700,color:"var(--t3)",textTransform:"uppercase",letterSpacing:".07em"}}>Lenders by Exposure</div>
        <div style={{maxHeight:560,overflowY:"auto"}}>
          {lenders.map(([name,data])=>{
            const urg=urgencyForLender(data);
            const pct=totalPort>0?data.totalBal/totalPort*100:0;
            const isActive=selLender===name;
            const noteCount=(notes[name]||[]).length;
            return(<div key={name} onClick={()=>setSelLender(isActive?null:name)}
              style={{padding:"12px 14px",cursor:"pointer",background:isActive?"var(--bg)":"transparent",borderLeft:`2px solid ${isActive?"var(--t1)":"transparent"}`,borderBottom:"1px solid var(--bd)",transition:"background .1s"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:5}}>
                <div style={{fontSize:12,fontWeight:700,color:isActive?"var(--t1)":"var(--t2)",lineHeight:1.3,flex:1}}>{name}</div>
                <div style={{width:8,height:8,borderRadius:"50%",background:urg==="red"?"var(--red)":urg==="amber"?"var(--amber)":"var(--green)",flexShrink:0,marginTop:2}}/>
              </div>
              <div style={{fontSize:11,fontWeight:600,color:"var(--t1)",marginBottom:4}}>{f$(data.totalBal)}</div>
              <div style={{height:4,borderRadius:2,background:"var(--bd)",marginBottom:4,overflow:"hidden"}}>
                <div style={{width:`${Math.min(100,pct)}%`,height:4,background:"var(--blue)",borderRadius:2}}/>
              </div>
              <div style={{display:"flex",justifyContent:"space-between",fontSize:9,color:"var(--t3)"}}>
                <span>{data.loans.length} loan{data.loans.length!==1?"s":""}</span>
                <span>{pct.toFixed(1)}% of portfolio</span>
                {noteCount>0&&<span style={{color:"var(--blue)"}}>📝 {noteCount}</span>}
              </div>
            </div>);
          })}
        </div>
      </div>

      {/* Lender detail */}
      <div>
        {!selLender&&<div style={{background:"var(--white)",border:"2px dashed var(--bd2)",borderRadius:14,padding:"64px 40px",textAlign:"center"}}>
          <div style={{fontSize:32,opacity:.15,marginBottom:12}}>🏦</div>
          <div style={{fontSize:15,fontWeight:700,color:"var(--t3)"}}>Select a lender to view their profile</div>
        </div>}

        {selLender&&LD&&<>
          {/* Lender header */}
          <div style={{background:"var(--white)",border:"1px solid var(--bd)",borderRadius:14,padding:"20px 22px",marginBottom:14}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
              <div>
                <div style={{fontSize:20,fontWeight:800,color:"var(--t1)",marginBottom:2}}>{selLender}</div>
                <div style={{fontSize:12,color:"var(--t3)"}}>{LD.loans.length} loan{LD.loans.length!==1?"s":" "} · {f$(LD.totalBal)} total exposure · {(LD.totalBal/totalPort*100).toFixed(1)}% of portfolio</div>
              </div>
              <div style={{textAlign:"right"}}>
                {LD.servicerPhone&&<div style={{fontSize:11,color:"var(--blue)",marginBottom:2}}>📞 <a href={`tel:${LD.servicerPhone}`} style={{color:"var(--blue)",textDecoration:"none"}}>{LD.servicerPhone}</a> <CopyBtn text={LD.servicerPhone}/></div>}
                {LD.servicerEmail&&<div style={{fontSize:11,color:"var(--blue)"}}>✉️ <a href={`mailto:${LD.servicerEmail}`} style={{color:"var(--blue)",textDecoration:"none"}}>{LD.servicerEmail}</a></div>}
              </div>
            </div>

            {/* Loans for this lender */}
            <div style={{marginTop:16,borderTop:"1px solid var(--bd)",paddingTop:14}}>
              <div style={{fontSize:10,fontWeight:700,color:"var(--t3)",textTransform:"uppercase",letterSpacing:".07em",marginBottom:8}}>Loans with this lender</div>
              <div style={{display:"flex",flexDirection:"column",gap:6}}>
                {LD.loans.map(l=>{
                  const el=enrich(l);
                  const ss={matured:"var(--red)",urgent:"var(--red)",soon:"var(--amber)",ok:"var(--green)"}[el.status];
                  return(<div key={l.id} onClick={()=>onSelect(l)}
                    style={{display:"flex",alignItems:"center",gap:12,padding:"10px 12px",background:"var(--bg)",borderRadius:9,cursor:"pointer",border:"1px solid var(--bd)"}}
                    onMouseEnter={e=>e.currentTarget.style.background="var(--bd)"}
                    onMouseLeave={e=>e.currentTarget.style.background="var(--bg)"}>
                    <div style={{width:6,height:6,borderRadius:"50%",background:ss,flexShrink:0}}/>
                    <div style={{flex:2}}><div style={{fontSize:12,fontWeight:700,color:"var(--t1)"}}>{l.addr}</div><div style={{fontSize:10,color:"var(--t3)"}}>{l.entity||""}</div></div>
                    <div style={{flex:1,textAlign:"center"}}><div style={{fontSize:11,fontWeight:700,color:"var(--t1)"}}>{f$(el.curBal)}</div><div style={{fontSize:9,color:"var(--t3)"}}>{fPct(l.rate)} {l.loanType}</div></div>
                    <div style={{flex:1,textAlign:"center"}}><div style={{fontSize:11,color:ss,fontWeight:600}}>{fDateS(l.maturityDate)}</div><div style={{fontSize:9,color:"var(--t3)"}}>{el.daysLeft>0?`${el.daysLeft}d left`:`${Math.abs(el.daysLeft)}d over`}</div></div>
                    <RefiChip status={l.refiStatus}/>
                    <div style={{fontSize:12,color:"var(--t4)"}}>›</div>
                  </div>);
                })}
              </div>
            </div>
          </div>

          {/* Relationship notes / activity */}
          <div style={{background:"var(--white)",border:"1px solid var(--bd)",borderRadius:14,overflow:"hidden"}}>
            <div style={{padding:"12px 18px",borderBottom:"1px solid var(--bd)",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div style={{fontSize:12,fontWeight:700,color:"var(--t1)"}}>Relationship Notes</div>
              <div style={{fontSize:10,color:"var(--t3)"}}>{(notes[selLender]||[]).length} entries</div>
            </div>

            {/* Note input */}
            <div style={{padding:"12px 18px",borderBottom:"1px solid var(--bd)",background:"var(--bg)"}}>
              <div style={{display:"flex",gap:6,marginBottom:8,flexWrap:"wrap"}}>
                {ACT_TYPES.map(a=><button key={a.id} onClick={()=>setNoteType(a.id)}
                  style={{padding:"4px 12px",borderRadius:20,border:`1px solid ${noteType===a.id?"var(--t1)":"var(--bd)"}`,background:noteType===a.id?"var(--t1)":"var(--white)",color:noteType===a.id?"var(--white)":"var(--t3)",fontSize:11,cursor:"pointer"}}>
                  {a.icon} {a.label}
                </button>)}
              </div>
              <div style={{display:"flex",gap:8}}>
                <input className="finp" style={{flex:1}} placeholder="Log a call, email, meeting, term sheet discussion…" value={newNote} onChange={e=>setNewNote(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addNote()}/>
                <button className="btn-dark" style={{fontSize:12,padding:"6px 16px"}} onClick={addNote}>Add</button>
              </div>
            </div>

            {/* Notes list */}
            {(notes[selLender]||[]).length===0
              ?<div style={{padding:"32px",textAlign:"center",color:"var(--t4)",fontSize:12}}>No notes yet — log your first interaction above.</div>
              :[...(notes[selLender]||[])].reverse().map(n=>{
                const at=ACT_TYPES.find(a=>a.id===n.type)||ACT_TYPES[4];
                return(<div key={n.id} style={{display:"flex",gap:12,padding:"12px 18px",borderBottom:"1px solid var(--bd)"}}>
                  <div style={{fontSize:18,flexShrink:0}}>{at.icon}</div>
                  <div style={{flex:1}}>
                    <div style={{fontSize:12,color:"var(--t1)",lineHeight:1.6}}>{n.text}</div>
                    <div style={{fontSize:10,color:"var(--t4)",marginTop:3}}>{at.label} · {fDateF(n.date)}</div>
                  </div>
                  <button onClick={()=>delNote(selLender,n.id)} style={{background:"none",border:"none",cursor:"pointer",fontSize:11,color:"var(--t4)",flexShrink:0}}>✕</button>
                </div>);
              })
            }
          </div>
        </>}
      </div>
    </div>
  </div>);
}

/* ─────────── ALERT SYSTEM ─────────── */

// Condition definitions — each has a label, description, and evaluator
const ALERT_CONDITIONS = [
  {
    id:"maturity_days",
    label:"Maturity Approaching",
    icon:"📅",
    category:"maturity",
    desc:"Fires when a loan matures within a specified number of days",
    param:{key:"days",label:"Days before maturity",type:"number",default:90},
    eval:(loan,p)=>{ const el=enrich(loan); return el.daysLeft>=0&&el.daysLeft<=p.days; },
    severity:(loan,p)=>{ const d=enrich(loan).daysLeft; return d<=30?"critical":d<=60?"high":"medium"; },
    detail:(loan,p)=>{ const el=enrich(loan); return `Matures ${fDateF(loan.maturityDate)} — ${el.daysLeft} days remaining`; },
  },
  {
    id:"maturity_overdue",
    label:"Maturity Past Due",
    icon:"🔴",
    category:"maturity",
    desc:"Fires when a loan has already passed its maturity date",
    param:null,
    eval:(loan)=>enrich(loan).daysLeft<0,
    severity:()=>"critical",
    detail:(loan)=>{ const el=enrich(loan); return `${Math.abs(el.daysLeft)} days past maturity — immediate action required`; },
  },
  {
    id:"dscr_below_covenant",
    label:"DSCR Below Covenant",
    icon:"🛡️",
    category:"risk",
    desc:"Fires when a loan's DSCR falls below its covenant threshold",
    param:null,
    eval:(loan)=>{ const el=enrich(loan); return el.dscr&&loan.dscrCovenant&&el.dscr<loan.dscrCovenant; },
    severity:()=>"critical",
    detail:(loan)=>{ const el=enrich(loan); return `DSCR ${el.dscr?.toFixed(2)}x is below covenant ${loan.dscrCovenant}x`; },
  },
  {
    id:"dscr_warning",
    label:"DSCR Approaching Covenant",
    icon:"⚠️",
    category:"risk",
    desc:"Fires when DSCR is within a specified % of the covenant floor",
    param:{key:"pct",label:"Headroom threshold (%)",type:"number",default:15},
    eval:(loan,p)=>{ const el=enrich(loan); if(!el.dscr||!loan.dscrCovenant)return false; const headroom=(el.dscr-loan.dscrCovenant)/loan.dscrCovenant*100; return headroom>=0&&headroom<=p.pct; },
    severity:()=>"high",
    detail:(loan,p)=>{ const el=enrich(loan); const h=((el.dscr-loan.dscrCovenant)/loan.dscrCovenant*100).toFixed(1); return `DSCR ${el.dscr?.toFixed(2)}x — only ${h}% above ${loan.dscrCovenant}x covenant`; },
  },
  {
    id:"rate_cap_expiry",
    label:"Rate Cap Expiring",
    icon:"📉",
    category:"risk",
    desc:"Fires when an ARM loan's rate cap expires within N days",
    param:{key:"days",label:"Days before cap expiry",type:"number",default:180},
    eval:(loan,p)=>{ if(!loan.capExpiry||(loan.loanType!=="ARM"&&loan.loanType!=="SOFR"))return false; const d=daysTo(loan.capExpiry); return d>=0&&d<=p.days; },
    severity:(loan,p)=>{ const d=daysTo(loan.capExpiry||"2099-01-01"); return d<=60?"critical":d<=120?"high":"medium"; },
    detail:(loan)=>{ const d=daysTo(loan.capExpiry||"2099-01-01"); return `Rate cap${loan.capProvider?` (${loan.capProvider})`:""}${loan.capRate?` @ ${fPct(loan.capRate)}`:""} expires ${fDateF(loan.capExpiry)} — ${d} days away`; },
  },
  {
    id:"rate_cap_expired",
    label:"Rate Cap Expired — Unprotected",
    icon:"🚨",
    category:"risk",
    desc:"Fires when an ARM loan has no cap or an expired cap",
    param:null,
    eval:(loan)=>{ if(loan.loanType!=="ARM"&&loan.loanType!=="SOFR")return false; return !loan.capExpiry||daysTo(loan.capExpiry)<0; },
    severity:()=>"critical",
    detail:(loan)=>{ return loan.capExpiry?`Cap expired ${fDateF(loan.capExpiry)} — loan is unprotected`:`No rate cap on record for ${loan.loanType} loan`; },
  },
  {
    id:"refi_not_started",
    label:"Refi Not Started Near Maturity",
    icon:"🔄",
    category:"maturity",
    desc:"Flags loans maturing within N days where refi has not been initiated",
    param:{key:"days",label:"Days before maturity",type:"number",default:180},
    eval:(loan,p)=>{ const el=enrich(loan); return el.daysLeft>=0&&el.daysLeft<=p.days&&(!loan.refiStatus||loan.refiStatus==="Not Started"); },
    severity:(loan,p)=>{ const d=enrich(loan).daysLeft; return d<=90?"critical":d<=120?"high":"medium"; },
    detail:(loan)=>{ const el=enrich(loan); return `Matures in ${el.daysLeft}d — refi status: "${loan.refiStatus||"Not Started"}"`.trim(); },
  },
  {
    id:"balance_threshold",
    label:"Large Loan Balance Alert",
    icon:"💰",
    category:"financial",
    desc:"Always-on flag for loans above a specified balance threshold",
    param:{key:"amount",label:"Balance threshold ($)",type:"number",default:5000000},
    eval:(loan,p)=>{ const el=enrich(loan); return el.curBal>=p.amount; },
    severity:()=>"low",
    detail:(loan)=>{ const el=enrich(loan); return `Current balance: ${f$(el.curBal)}`; },
  },
  {
    id:"no_activity",
    label:"No Recent Activity",
    icon:"💤",
    category:"operational",
    desc:"Flags loans with no logged activity in the past N days",
    param:{key:"days",label:"Days since last activity",type:"number",default:60},
    eval:(loan,p)=>{ if(!loan.activityLog?.length)return true; const last=new Date(loan.activityLog[loan.activityLog.length-1].date); return (TODAY-last)/86400000>p.days; },
    severity:()=>"low",
    detail:(loan,p)=>{ if(!loan.activityLog?.length)return"No activity ever logged"; const last=loan.activityLog[loan.activityLog.length-1]; return `Last activity ${fDateF(last.date)} — ${Math.round((TODAY-new Date(last.date))/86400000)}d ago`; },
  },
  {
    id:"prepay_window",
    label:"Prepayment Window Opening",
    icon:"🔓",
    category:"maturity",
    desc:"Fires when a step-down loan enters its final 0% prepay year",
    param:{key:"days",label:"Days advance notice",type:"number",default:60},
    eval:(loan,p)=>{ if(!loan.prepay)return false; const nums=(loan.prepay||"").match(/\d+/g); if(!nums)return false; const steps=nums.map(Number); const yearsElapsed=Math.floor(mosBetween(loan.origDate||TODAY_STR,TODAY_STR)/12); return steps[yearsElapsed]===0||(steps.length>0&&yearsElapsed>=steps.length); },
    severity:()=>"medium",
    detail:(loan)=>{ return `Prepay schedule: ${loan.prepay} — current window may be open`; },
  },
];

const SEVERITY_META = {
  critical:{label:"Critical",color:"#dc2626",bg:"#fef2f2",bd:"#fecaca",dot:"#dc2626"},
  high:    {label:"High",color:"#d97706",bg:"#fffbeb",bd:"#fde68a",dot:"#f59e0b"},
  medium:  {label:"Medium",color:"#2563eb",bg:"#eff6ff",bd:"#bfdbfe",dot:"#3b82f6"},
  low:     {label:"Low",color:"#6b7280",bg:"#f9fafb",bd:"#e5e7eb",dot:"#9ca3af"},
};

const CHANNELS = [
  {id:"email",icon:"✉️",label:"Email"},
  {id:"sms",icon:"📱",label:"SMS / Text"},
  {id:"both",icon:"📣",label:"Email + SMS"},
];

function AlertSystem({loans}){
  // Rules storage
  const [rules,setRules] = useState([]);
  const [recipients,setRecipients] = useState([]);
  const [alertLog,setAlertLog] = useState([]);
  const [loaded,setLoaded] = useState(false);

  // UI state
  const [activeTab,setActiveTab] = useState("dashboard"); // dashboard | rules | recipients | log | preview
  const [editRule,setEditRule] = useState(null); // null | "new" | ruleId
  const [previewAlert,setPreviewAlert] = useState(null);
  const [generatingMsg,setGeneratingMsg] = useState(false);
  const [generatedMsg,setGeneratedMsg] = useState(null);
  const [filterSeverity,setFilterSeverity] = useState("all");
  const [searchFilter,setSearchFilter] = useState("");

  // Load/save
  useEffect(()=>{(async()=>{
    try{
      const r=await supaStorage.get("meridian-alert-rules"); if(r?.value)setRules(JSON.parse(r.value));
      const rc=await supaStorage.get("meridian-alert-recipients"); if(rc?.value)setRecipients(JSON.parse(rc.value));
      const al=await supaStorage.get("meridian-alert-log"); if(al?.value)setAlertLog(JSON.parse(al.value));
    }catch{}
    setLoaded(true);
  })();},[]);
  useEffect(()=>{if(!loaded)return;(async()=>{try{await supaStorage.set("meridian-alert-rules",JSON.stringify(rules));}catch{}})();},[rules,loaded]);
  useEffect(()=>{if(!loaded)return;(async()=>{try{await supaStorage.set("meridian-alert-recipients",JSON.stringify(recipients));}catch{}})();},[recipients,loaded]);
  useEffect(()=>{if(!loaded)return;(async()=>{try{await supaStorage.set("meridian-alert-log",JSON.stringify(alertLog));}catch{}})();},[alertLog,loaded]);

  // Evaluate all active rules against current loan data
  const liveAlerts = useMemo(()=>{
    const out=[];
    for(const rule of rules.filter(r=>r.active)){
      const cond=ALERT_CONDITIONS.find(c=>c.id===rule.conditionId);
      if(!cond)continue;
      const targetLoans=rule.loanFilter==="all"?loans:loans.filter(l=>rule.loanIds?.includes(l.id));
      for(const loan of targetLoans){
        try{
          const fires=cond.eval(loan,rule.params||{});
          if(fires){
            const sev=cond.severity(loan,rule.params||{});
            out.push({ruleId:rule.id,ruleName:rule.name,conditionId:rule.conditionId,loan,severity:sev,detail:cond.detail(loan,rule.params||{}),rule,cond,ts:Date.now()});
          }
        }catch{}
      }
    }
    return out.sort((a,b)=>{const o={critical:0,high:1,medium:2,low:3};return(o[a.severity]||4)-(o[b.severity]||4);});
  },[rules,loans]);

  const filteredAlerts = useMemo(()=>liveAlerts.filter(a=>{
    if(filterSeverity!=="all"&&a.severity!==filterSeverity)return false;
    if(searchFilter&&!a.loan.addr.toLowerCase().includes(searchFilter.toLowerCase())&&!a.ruleName.toLowerCase().includes(searchFilter.toLowerCase()))return false;
    return true;
  }),[liveAlerts,filterSeverity,searchFilter]);

  const critCount=liveAlerts.filter(a=>a.severity==="critical").length;
  const highCount=liveAlerts.filter(a=>a.severity==="high").length;

  // Generate AI notification message
  const generateNotification = async(alert,channel)=>{
    setGeneratingMsg(true);
    setGeneratedMsg(null);
    const el=enrich(alert.loan);
    const prompt=`Generate a concise, professional ${channel==="sms"?"SMS text message (under 160 chars)":"email"} notification for a commercial real estate mortgage alert.

Alert Type: ${alert.cond.label}
Property: ${alert.loan.addr}
Lender: ${alert.loan.lender}
Loan Balance: ${f$(el.curBal)}
Rate: ${fPct(alert.loan.rate)} ${alert.loan.loanType}
Maturity: ${fDateF(alert.loan.maturityDate)} (${el.daysLeft>0?el.daysLeft+" days remaining":Math.abs(el.daysLeft)+" days overdue"})
Alert Detail: ${alert.detail}
Severity: ${alert.severity.toUpperCase()}
Rule Name: "${alert.ruleName}"

${channel==="email"?`Write a professional email with:
- Subject line (prefix: [MERIDIAN ALERT])
- Brief greeting
- Clear description of the issue and urgency
- The specific loan details
- A recommended action or next step
- Sign off as "Meridian Properties — Automated Alert System"

Format as:
SUBJECT: [subject line]
BODY:
[email body]`:`Write a single SMS under 160 characters. Be direct. Include property address, issue, and one action. No emojis.`}`;

    try{
      const resp=await fetch("https://api.anthropic.com/v1/messages",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:600,messages:[{role:"user",content:prompt}]})
      });
      const data=await resp.json();
      const text=data.content?.filter(b=>b.type==="text").map(b=>b.text).join("")||"";
      setGeneratedMsg({text,channel,alert});
    }catch(e){setGeneratedMsg({text:`Error generating message: ${e.message}`,error:true});}
    setGeneratingMsg(false);
  };

  // Log a "sent" action
  const logSend=(alert,channel,recipientIds)=>{
    const entry={id:Date.now(),ruleId:alert.ruleId,ruleName:alert.ruleName,loanAddr:alert.loan.addr,severity:alert.severity,detail:alert.detail,channel,recipientIds,ts:new Date().toISOString(),sentBy:"Manual trigger"};
    setAlertLog(p=>[entry,...p].slice(0,200));
  };

  // ── RULE EDITOR ──
  const RuleEditor=({ruleId,onClose})=>{
    const existing=ruleId&&ruleId!=="new"?rules.find(r=>r.id===ruleId):null;
    const [name,setName]=useState(existing?.name||"");
    const [condId,setCondId]=useState(existing?.conditionId||ALERT_CONDITIONS[0].id);
    const [params,setParams]=useState(existing?.params||{});
    const [loanFilter,setLoanFilter]=useState(existing?.loanFilter||"all");
    const [loanIds,setLoanIds]=useState(existing?.loanIds||[]);
    const [channel,setChannel]=useState(existing?.channel||"email");
    const [recipientIds,setRecipientIds]=useState(existing?.recipientIds||[]);
    const [active,setActive]=useState(existing?.active!==false);

    const cond=ALERT_CONDITIONS.find(c=>c.id===condId);

    const save=()=>{
      if(!name.trim()){alert("Please name this alert rule.");return;}
      const rule={id:existing?.id||Date.now(),name:name.trim(),conditionId:condId,params,loanFilter,loanIds,channel,recipientIds,active,createdAt:existing?.createdAt||TODAY_STR,updatedAt:TODAY_STR};
      if(existing){setRules(p=>p.map(r=>r.id===existing.id?rule:r));}
      else{setRules(p=>[...p,rule]);}
      onClose();
    };

    const toggleLoan=id=>setLoanIds(p=>p.includes(id)?p.filter(x=>x!==id):[...p,id]);
    const toggleRec=id=>setRecipientIds(p=>p.includes(id)?p.filter(x=>x!==id):[...p,id]);

    return(<div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.5)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",padding:24}} onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={{background:"var(--white)",borderRadius:18,width:"100%",maxWidth:620,maxHeight:"90vh",overflow:"hidden",display:"flex",flexDirection:"column",boxShadow:"0 24px 64px rgba(0,0,0,.25)"}}>
        <div style={{padding:"18px 24px",borderBottom:"1px solid var(--bd)",display:"flex",justifyContent:"space-between",alignItems:"center",flexShrink:0}}>
          <div style={{fontSize:15,fontWeight:800,color:"var(--t1)"}}>{existing?"Edit Alert Rule":"New Alert Rule"}</div>
          <button onClick={onClose} style={{background:"none",border:"none",fontSize:18,color:"var(--t3)",cursor:"pointer"}}>✕</button>
        </div>
        <div style={{overflowY:"auto",padding:"20px 24px",flex:1,display:"flex",flexDirection:"column",gap:18}}>

          {/* Name */}
          <div>
            <div className="flbl" style={{display:"block",marginBottom:4}}>Rule Name *</div>
            <input className="finp" placeholder="e.g. 90-Day Maturity Warning" value={name} onChange={e=>setName(e.target.value)}/>
          </div>

          {/* Condition picker */}
          <div>
            <div className="flbl" style={{display:"block",marginBottom:8}}>Alert Condition</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
              {ALERT_CONDITIONS.map(c=>(
                <div key={c.id} onClick={()=>{setCondId(c.id);setParams({});}}
                  style={{padding:"10px 12px",borderRadius:10,border:`2px solid ${condId===c.id?"var(--blue)":"var(--bd)"}`,background:condId===c.id?"var(--bbg)":"var(--white)",cursor:"pointer",transition:"all .12s"}}>
                  <div style={{fontSize:13,fontWeight:700,color:condId===c.id?"var(--blue)":"var(--t1)",marginBottom:2}}>{c.icon} {c.label}</div>
                  <div style={{fontSize:10,color:"var(--t3)",lineHeight:1.4}}>{c.desc}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Condition param */}
          {cond?.param&&<div>
            <div className="flbl" style={{display:"block",marginBottom:4}}>{cond.param.label}</div>
            <input className="finp" type={cond.param.type} value={params[cond.param.key]??cond.param.default} onChange={e=>setParams(p=>({...p,[cond.param.key]:parseFloat(e.target.value)||cond.param.default}))} style={{maxWidth:200}}/>
          </div>}

          {/* Loan filter */}
          <div>
            <div className="flbl" style={{display:"block",marginBottom:8}}>Apply to Loans</div>
            <div style={{display:"flex",gap:8,marginBottom:10}}>
              {[["all","All Loans"],["specific","Specific Loans"]].map(([id,lbl])=>(
                <button key={id} onClick={()=>setLoanFilter(id)} style={{padding:"6px 16px",borderRadius:8,border:`1px solid ${loanFilter===id?"var(--t1)":"var(--bd)"}`,background:loanFilter===id?"var(--t1)":"var(--white)",color:loanFilter===id?"#fff":"var(--t3)",fontSize:12,fontWeight:600,cursor:"pointer"}}>{lbl}</button>
              ))}
            </div>
            {loanFilter==="specific"&&<div style={{maxHeight:160,overflowY:"auto",border:"1px solid var(--bd)",borderRadius:10,display:"flex",flexDirection:"column",gap:0}}>
              {loans.map(l=>(
                <label key={l.id} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 12px",borderBottom:"1px solid var(--bd)",cursor:"pointer",background:loanIds.includes(l.id)?"var(--bbg)":"transparent"}}>
                  <input type="checkbox" checked={loanIds.includes(l.id)} onChange={()=>toggleLoan(l.id)} style={{accentColor:"var(--blue)"}}/>
                  <div><div style={{fontSize:11,fontWeight:600,color:"var(--t1)"}}>{l.addr}</div><div style={{fontSize:10,color:"var(--t3)"}}>{l.lender} · {fPct(l.rate)}</div></div>
                </label>
              ))}
            </div>}
          </div>

          {/* Channel */}
          <div>
            <div className="flbl" style={{display:"block",marginBottom:8}}>Notification Channel</div>
            <div style={{display:"flex",gap:8}}>
              {CHANNELS.map(ch=>(
                <button key={ch.id} onClick={()=>setChannel(ch.id)} style={{padding:"7px 16px",borderRadius:8,border:`1px solid ${channel===ch.id?"var(--t1)":"var(--bd)"}`,background:channel===ch.id?"var(--t1)":"var(--white)",color:channel===ch.id?"#fff":"var(--t3)",fontSize:12,fontWeight:600,cursor:"pointer"}}>{ch.icon} {ch.label}</button>
              ))}
            </div>
          </div>

          {/* Recipients */}
          <div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
              <div className="flbl">Recipients</div>
              {recipients.length===0&&<span style={{fontSize:10,color:"var(--amber)"}}>⚠ Add recipients first</span>}
            </div>
            {recipients.length===0?<div style={{fontSize:11,color:"var(--t4)",padding:"10px 0"}}>No recipients configured. Go to the Recipients tab to add contacts.</div>
            :<div style={{display:"flex",flexDirection:"column",gap:4}}>
              {recipients.map(r=>(
                <label key={r.id} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 12px",borderRadius:8,border:"1px solid var(--bd)",cursor:"pointer",background:recipientIds.includes(r.id)?"var(--bbg)":"transparent"}}>
                  <input type="checkbox" checked={recipientIds.includes(r.id)} onChange={()=>toggleRec(r.id)} style={{accentColor:"var(--blue)"}}/>
                  <div><div style={{fontSize:11,fontWeight:600,color:"var(--t1)"}}>{r.name}</div><div style={{fontSize:10,color:"var(--t3)"}}>{r.email}{r.phone?` · ${r.phone}`:""} · {r.role}</div></div>
                </label>
              ))}
            </div>}
          </div>

          {/* Active toggle */}
          <div style={{display:"flex",alignItems:"center",gap:12,padding:"10px 14px",background:"var(--bg)",borderRadius:10}}>
            <div style={{flex:1}}>
              <div style={{fontSize:12,fontWeight:700,color:"var(--t1)"}}>Rule Active</div>
              <div style={{fontSize:10,color:"var(--t3)"}}>Inactive rules won't generate alerts or appear on the dashboard</div>
            </div>
            <div onClick={()=>setActive(s=>!s)} style={{width:44,height:24,borderRadius:12,background:active?"var(--green)":"var(--bd2)",cursor:"pointer",position:"relative",transition:"background .2s",flexShrink:0}}>
              <div style={{width:18,height:18,borderRadius:"50%",background:"#fff",position:"absolute",top:3,left:active?23:3,transition:"left .2s",boxShadow:"0 1px 4px rgba(0,0,0,.2)"}}/>
            </div>
          </div>
        </div>
        <div style={{padding:"14px 24px",borderTop:"1px solid var(--bd)",display:"flex",justifyContent:"flex-end",gap:8,flexShrink:0}}>
          <button className="btn-light" onClick={onClose}>Cancel</button>
          <button className="btn-dark" onClick={save}>{existing?"Save Changes":"Create Rule"}</button>
        </div>
      </div>
    </div>);
  };

  // ── PREVIEW MODAL ──
  const PreviewModal=({alert,onClose})=>{
    const el=enrich(alert.loan);
    const sm=SEVERITY_META[alert.severity];
    const ruleRecipients=recipients.filter(r=>alert.rule.recipientIds?.includes(r.id));

    return(<div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.5)",zIndex:1000,display:"flex",alignItems:"flex-start",justifyContent:"center",padding:24,overflowY:"auto"}} onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={{background:"var(--white)",borderRadius:18,width:"100%",maxWidth:680,overflow:"hidden",boxShadow:"0 24px 64px rgba(0,0,0,.25)",margin:"auto"}}>
        <div style={{padding:"18px 24px",borderBottom:"1px solid var(--bd)",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div>
            <div style={{fontSize:9,fontWeight:800,color:sm.color,textTransform:"uppercase",letterSpacing:".1em",marginBottom:3}}>{sm.label} Alert</div>
            <div style={{fontSize:15,fontWeight:800,color:"var(--t1)"}}>{alert.cond.icon} {alert.cond.label}</div>
          </div>
          <button onClick={onClose} style={{background:"none",border:"none",fontSize:18,color:"var(--t3)",cursor:"pointer"}}>✕</button>
        </div>
        <div style={{padding:"20px 24px",display:"flex",flexDirection:"column",gap:16}}>

          {/* Alert context */}
          <div style={{background:sm.bg,border:`1px solid ${sm.bd}`,borderRadius:12,padding:"14px 16px"}}>
            <div style={{fontSize:13,fontWeight:700,color:sm.color,marginBottom:4}}>{alert.loan.addr}</div>
            <div style={{fontSize:12,color:"var(--t2)",marginBottom:8}}>{alert.detail}</div>
            <div style={{display:"flex",gap:20,fontSize:11,color:"var(--t3)"}}>
              <span>Balance: <strong style={{color:"var(--t1)"}}>{f$(el.curBal)}</strong></span>
              <span>Rate: <strong style={{color:"var(--t1)"}}>{fPct(alert.loan.rate)} {alert.loan.loanType}</strong></span>
              <span>Maturity: <strong style={{color:el.daysLeft<90?"var(--red)":"var(--t1)"}}>{fDateF(alert.loan.maturityDate)}</strong></span>
            </div>
          </div>

          {/* Recipients */}
          {ruleRecipients.length>0&&<div>
            <div style={{fontSize:11,fontWeight:700,color:"var(--t3)",textTransform:"uppercase",letterSpacing:".07em",marginBottom:8}}>Configured Recipients</div>
            <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
              {ruleRecipients.map(r=>(
                <div key={r.id} style={{padding:"5px 12px",background:"var(--bg)",border:"1px solid var(--bd)",borderRadius:20,fontSize:11,color:"var(--t2)"}}>
                  {r.name} <span style={{color:"var(--t4)"}}>({alert.rule.channel==="sms"?r.phone||r.email:r.email})</span>
                </div>
              ))}
            </div>
          </div>}

          {/* Generate message */}
          <div style={{borderTop:"1px solid var(--bd)",paddingTop:16}}>
            <div style={{fontSize:13,fontWeight:700,color:"var(--t1)",marginBottom:10}}>Generate Notification Message</div>
            <div style={{display:"flex",gap:8,marginBottom:12}}>
              {CHANNELS.map(ch=>(
                <button key={ch.id} onClick={()=>generateNotification(alert,ch.id==="both"?"email":ch.id)} disabled={generatingMsg}
                  style={{padding:"7px 16px",background:"var(--bg)",border:"1px solid var(--bd2)",borderRadius:9,fontSize:11,color:"var(--t2)",cursor:"pointer",fontWeight:600,transition:"all .12s"}}
                  onMouseEnter={e=>{e.currentTarget.style.borderColor="var(--blue)";}}
                  onMouseLeave={e=>{e.currentTarget.style.borderColor="var(--bd2);";}}>
                  {generatingMsg?"⏳ Generating…":`${ch.icon} Draft ${ch.label}`}
                </button>
              ))}
            </div>

            {generatedMsg&&!generatedMsg.error&&<>
              <div style={{background:"var(--bg)",border:"1px solid var(--bd)",borderRadius:12,overflow:"hidden"}}>
                <div style={{padding:"10px 14px",borderBottom:"1px solid var(--bd)",display:"flex",justifyContent:"space-between",alignItems:"center",background:"var(--white)"}}>
                  <div style={{fontSize:11,fontWeight:700,color:"var(--t2)"}}>
                    {generatedMsg.channel==="sms"?"📱 SMS Draft":"✉️ Email Draft"} — AI Generated
                  </div>
                  <button onClick={()=>navigator.clipboard?.writeText(generatedMsg.text)} style={{padding:"3px 10px",background:"var(--t1)",border:"none",borderRadius:6,fontSize:10,color:"#fff",cursor:"pointer",fontWeight:600}}>Copy</button>
                </div>
                <pre style={{padding:"14px 16px",fontSize:11,color:"var(--t1)",lineHeight:1.7,whiteSpace:"pre-wrap",fontFamily:"inherit",maxHeight:280,overflowY:"auto"}}>{generatedMsg.text}</pre>
              </div>

              {/* Send options */}
              {ruleRecipients.length>0&&<div style={{marginTop:10,display:"flex",gap:8,flexWrap:"wrap"}}>
                {ruleRecipients.map(r=>(
                  <div key={r.id} style={{display:"flex",gap:6}}>
                    {(alert.rule.channel==="email"||alert.rule.channel==="both")&&r.email&&<a
                      href={`mailto:${r.email}?subject=${encodeURIComponent(generatedMsg.text.match(/SUBJECT:\s*(.+)/)?.[1]||"[MERIDIAN ALERT]")}&body=${encodeURIComponent(generatedMsg.text.replace(/SUBJECT:.+\nBODY:\n/s,""))}`}
                      onClick={()=>logSend(alert,alert.rule.channel,[r.id])}
                      style={{padding:"6px 14px",background:"var(--t1)",borderRadius:8,fontSize:11,color:"#fff",textDecoration:"none",fontWeight:600,display:"inline-flex",alignItems:"center",gap:5}}>
                      ✉️ Send to {r.name}
                    </a>}
                    {(alert.rule.channel==="sms"||alert.rule.channel==="both")&&r.phone&&<a
                      href={`sms:${r.phone}?body=${encodeURIComponent(generatedMsg.text)}`}
                      onClick={()=>logSend(alert,alert.rule.channel,[r.id])}
                      style={{padding:"6px 14px",background:"#16a34a",borderRadius:8,fontSize:11,color:"#fff",textDecoration:"none",fontWeight:600,display:"inline-flex",alignItems:"center",gap:5}}>
                      📱 Text {r.name}
                    </a>}
                  </div>
                ))}
              </div>}
            </>}
          </div>
        </div>
      </div>
    </div>);
  };

  // ── RECIPIENT MANAGER ──
  const RecipientForm=()=>{
    const [name,setName]=useState("");
    const [email,setEmail]=useState("");
    const [phone,setPhone]=useState("");
    const [role,setRole]=useState("Property Manager");
    const add=()=>{
      if(!name||(!email&&!phone)){alert("Name and at least one contact method required.");return;}
      setRecipients(p=>[...p,{id:Date.now(),name,email,phone,role}]);
      setName("");setEmail("");setPhone("");setRole("Property Manager");
    };
    return(<div style={{background:"var(--white)",border:"1px solid var(--bd)",borderRadius:14,padding:"16px 20px",marginBottom:16}}>
      <div style={{fontSize:13,fontWeight:700,color:"var(--t1)",marginBottom:12}}>Add Recipient</div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
        <div><div className="flbl" style={{display:"block",marginBottom:3}}>Name *</div><input className="finp" value={name} onChange={e=>setName(e.target.value)} placeholder="Maria Lopez"/></div>
        <div><div className="flbl" style={{display:"block",marginBottom:3}}>Role</div><select className="finp" value={role} onChange={e=>setRole(e.target.value)}>{["Owner","Property Manager","Asset Manager","Accountant","Lender Contact","Attorney","Other"].map(r=><option key={r}>{r}</option>)}</select></div>
        <div><div className="flbl" style={{display:"block",marginBottom:3}}>Email</div><input className="finp" type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="maria@meridian.com"/></div>
        <div><div className="flbl" style={{display:"block",marginBottom:3}}>Phone (for SMS)</div><input className="finp" type="tel" value={phone} onChange={e=>setPhone(e.target.value)} placeholder="+1 718 555 0100"/></div>
      </div>
      <button className="btn-dark" onClick={add} style={{fontSize:12}}>+ Add Recipient</button>
    </div>);
  };

  return(<div>
    {/* Header */}
    <div style={{marginBottom:20}}>
      <div style={{fontSize:22,fontWeight:700,color:"var(--t1)",marginBottom:4}}>Alert System</div>
      <div style={{fontSize:13,color:"var(--t3)"}}>Configure rules, manage recipients, and generate email/SMS notifications when debt events occur.</div>
    </div>

    {/* Live alert banner */}
    {critCount>0&&<div style={{background:"var(--rbg)",border:"1px solid var(--rbd)",borderRadius:12,padding:"12px 18px",marginBottom:16,display:"flex",alignItems:"center",gap:14}}>
      <div style={{fontSize:24,flexShrink:0}}>🚨</div>
      <div style={{flex:1}}>
        <div style={{fontSize:13,fontWeight:800,color:"var(--red)"}}>
          {critCount} CRITICAL ALERT{critCount!==1?"S":""} — ACTION REQUIRED
        </div>
        <div style={{fontSize:11,color:"var(--t2)",marginTop:2}}>
          {liveAlerts.filter(a=>a.severity==="critical").slice(0,3).map(a=>a.loan.addr).join(", ")}{critCount>3?` +${critCount-3} more`:""}
        </div>
      </div>
      <button className="btn-dark" onClick={()=>setActiveTab("dashboard")} style={{background:"var(--red)",fontSize:12,flexShrink:0}}>View Alerts</button>
    </div>}

    {/* Tab bar */}
    <div style={{display:"flex",gap:2,marginBottom:20,background:"var(--white)",border:"1px solid var(--bd)",borderRadius:11,padding:3,width:"fit-content"}}>
      {[
        {id:"dashboard",label:`🔔 Live Alerts${liveAlerts.length>0?` (${liveAlerts.length})`:""}`,badge:critCount+highCount},
        {id:"rules",label:`⚙️ Rules (${rules.length})`},
        {id:"recipients",label:`👥 Recipients (${recipients.length})`},
        {id:"log",label:`📋 Send Log (${alertLog.length})`},
      ].map(t=>(
        <button key={t.id} onClick={()=>setActiveTab(t.id)} style={{
          padding:"7px 16px",borderRadius:8,border:"none",fontSize:12,fontWeight:activeTab===t.id?700:400,
          background:activeTab===t.id?"var(--t1)":"transparent",
          color:activeTab===t.id?"#fff":"var(--t3)",cursor:"pointer",position:"relative",whiteSpace:"nowrap",
        }}>
          {t.label}
          {t.id==="dashboard"&&(critCount>0)&&<span style={{position:"absolute",top:4,right:4,width:7,height:7,background:"var(--red)",borderRadius:"50%"}}/>}
        </button>
      ))}
    </div>

    {/* ── DASHBOARD TAB ── */}
    {activeTab==="dashboard"&&<>
      {/* Summary KPIs */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:20}}>
        {Object.entries(SEVERITY_META).map(([sev,m])=>{
          const cnt=liveAlerts.filter(a=>a.severity===sev).length;
          return(<div key={sev} style={{background:m.bg,border:`1px solid ${m.bd}`,borderRadius:12,padding:"14px 16px",cursor:cnt>0?"pointer":"default"}} onClick={()=>{if(cnt>0){setFilterSeverity(sev);}}}>
            <div style={{fontSize:9,fontWeight:800,color:m.color,textTransform:"uppercase",letterSpacing:".08em",marginBottom:6}}>{m.label}</div>
            <div style={{fontSize:28,fontWeight:800,color:m.color,lineHeight:1}}>{cnt}</div>
          </div>);
        })}
      </div>

      {/* Filters */}
      <div style={{display:"flex",gap:8,marginBottom:16,alignItems:"center",flexWrap:"wrap"}}>
        <input value={searchFilter} onChange={e=>setSearchFilter(e.target.value)} placeholder="Search property or rule…" style={{flex:1,minWidth:180,maxWidth:280,padding:"7px 12px",border:"1px solid var(--bd)",borderRadius:9,fontSize:12,color:"var(--t1)",background:"var(--white)",outline:"none"}}/>
        <div style={{display:"flex",gap:4}}>
          {["all","critical","high","medium","low"].map(s=>(
            <button key={s} onClick={()=>setFilterSeverity(s)} style={{padding:"5px 12px",borderRadius:20,border:"1px solid",fontSize:10,fontWeight:filterSeverity===s?800:500,cursor:"pointer",
              background:filterSeverity===s?(s==="all"?"var(--t1)":SEVERITY_META[s]?.bg||"var(--bg)"):"var(--white)",
              color:filterSeverity===s?(s==="all"?"#fff":SEVERITY_META[s]?.color||"var(--t1)"):"var(--t3)",
              borderColor:filterSeverity===s?(s==="all"?"var(--t1)":SEVERITY_META[s]?.bd||"var(--bd)"):"var(--bd)",
            }}>{s==="all"?"All":s.charAt(0).toUpperCase()+s.slice(1)}</button>
          ))}
        </div>
        {rules.filter(r=>r.active).length===0&&<span style={{fontSize:11,color:"var(--amber)"}}>⚠ No active rules — go to Rules tab to set up alerts</span>}
      </div>

      {filteredAlerts.length===0?<div style={{background:"var(--white)",border:"2px dashed var(--bd2)",borderRadius:16,padding:"48px 32px",textAlign:"center"}}>
        <div style={{fontSize:32,opacity:.2,marginBottom:10}}>{rules.filter(r=>r.active).length===0?"⚙️":"✅"}</div>
        <div style={{fontSize:15,fontWeight:700,color:"var(--t3)",marginBottom:6}}>
          {rules.filter(r=>r.active).length===0?"No active alert rules configured":"No alerts triggered — all clear"}
        </div>
        <div style={{fontSize:12,color:"var(--t4)",marginBottom:16}}>
          {rules.filter(r=>r.active).length===0?"Create rules in the Rules tab to start monitoring your portfolio":"Your portfolio meets all configured alert thresholds"}
        </div>
        {rules.filter(r=>r.active).length===0&&<button className="btn-dark" onClick={()=>setActiveTab("rules")}>+ Create First Rule</button>}
      </div>:<div style={{display:"flex",flexDirection:"column",gap:8}}>
        {filteredAlerts.map((a,i)=>{
          const sm=SEVERITY_META[a.severity];
          const el=enrich(a.loan);
          const ruleRecs=recipients.filter(r=>a.rule.recipientIds?.includes(r.id));
          return(<div key={i} style={{background:"var(--white)",border:`1px solid ${sm.bd}`,borderLeft:`3px solid ${sm.color}`,borderRadius:12,padding:"13px 16px",display:"flex",alignItems:"flex-start",gap:14,cursor:"pointer",transition:"box-shadow .1s"}}
            onMouseEnter={e=>e.currentTarget.style.boxShadow="0 4px 14px rgba(0,0,0,.07)"}
            onMouseLeave={e=>e.currentTarget.style.boxShadow=""}>
            <div style={{marginTop:1,flexShrink:0}}>
              <span style={{fontSize:9,fontWeight:800,padding:"3px 9px",borderRadius:20,background:sm.color,color:"#fff",letterSpacing:".07em",whiteSpace:"nowrap"}}>{sm.label}</span>
            </div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{display:"flex",alignItems:"baseline",gap:10,marginBottom:2,flexWrap:"wrap"}}>
                <div style={{fontSize:13,fontWeight:700,color:"var(--t1)"}}>{a.loan.addr}</div>
                <div style={{fontSize:10,color:"var(--t3)"}}>{a.cond.icon} {a.cond.label}</div>
              </div>
              <div style={{fontSize:11,color:"var(--t2)",marginBottom:6}}>{a.detail}</div>
              <div style={{display:"flex",gap:16,fontSize:10,color:"var(--t4)",flexWrap:"wrap"}}>
                <span>Rule: <strong style={{color:"var(--t3)"}}>{a.ruleName}</strong></span>
                <span>{f$(el.curBal)}</span>
                <span>{fPct(a.loan.rate)} {a.loan.loanType}</span>
                <span>Matures {fDateS(a.loan.maturityDate)}</span>
                {ruleRecs.length>0&&<span>→ {ruleRecs.map(r=>r.name).join(", ")}</span>}
              </div>
            </div>
            <button onClick={()=>setPreviewAlert(a)} style={{padding:"6px 14px",background:"var(--t1)",border:"none",borderRadius:8,fontSize:11,color:"#fff",cursor:"pointer",fontWeight:700,flexShrink:0,whiteSpace:"nowrap"}}>
              📣 Notify
            </button>
          </div>);
        })}
      </div>}
    </>}

    {/* ── RULES TAB ── */}
    {activeTab==="rules"&&<>
      <div style={{display:"flex",justifyContent:"flex-end",marginBottom:14}}>
        <button className="btn-dark" onClick={()=>setEditRule("new")}>+ New Alert Rule</button>
      </div>
      {rules.length===0?<div style={{background:"var(--white)",border:"2px dashed var(--bd2)",borderRadius:16,padding:"48px 32px",textAlign:"center"}}>
        <div style={{fontSize:32,opacity:.2,marginBottom:10}}>⚙️</div>
        <div style={{fontSize:15,fontWeight:700,color:"var(--t3)",marginBottom:8}}>No alert rules yet</div>
        <div style={{fontSize:12,color:"var(--t4)",marginBottom:16}}>Create rules to monitor maturities, DSCR covenants, rate caps, and more across your entire portfolio.</div>
        <button className="btn-dark" onClick={()=>setEditRule("new")}>+ Create First Rule</button>
      </div>:<div style={{display:"flex",flexDirection:"column",gap:8}}>
        {rules.map(rule=>{
          const cond=ALERT_CONDITIONS.find(c=>c.id===rule.conditionId);
          const activeAlerts=liveAlerts.filter(a=>a.ruleId===rule.id);
          const ruleRecs=recipients.filter(r=>rule.recipientIds?.includes(r.id));
          return(<div key={rule.id} style={{background:"var(--white)",border:"1px solid var(--bd)",borderRadius:12,padding:"13px 18px",display:"flex",alignItems:"center",gap:14,opacity:rule.active?1:.55}}>
            <div style={{width:10,height:10,borderRadius:"50%",background:rule.active?"var(--green)":"var(--bd2)",flexShrink:0}}/>
            <div style={{flex:1}}>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:3,flexWrap:"wrap"}}>
                <div style={{fontSize:13,fontWeight:700,color:"var(--t1)"}}>{rule.name}</div>
                {activeAlerts.length>0&&<span style={{fontSize:9,fontWeight:800,padding:"2px 8px",borderRadius:10,background:"var(--rbg)",color:"var(--red)",border:"1px solid var(--rbd)"}}>{activeAlerts.length} ACTIVE</span>}
              </div>
              <div style={{fontSize:11,color:"var(--t3)",marginBottom:3}}>{cond?.icon} {cond?.label} · {rule.loanFilter==="all"?"All loans":`${rule.loanIds?.length||0} specific loans`}</div>
              <div style={{fontSize:10,color:"var(--t4)"}}>{CHANNELS.find(c=>c.id===rule.channel)?.icon} {CHANNELS.find(c=>c.id===rule.channel)?.label} {ruleRecs.length>0?`→ ${ruleRecs.map(r=>r.name).join(", ")}`:"(no recipients)"}</div>
            </div>
            <div style={{display:"flex",gap:6}}>
              <button onClick={()=>setRules(p=>p.map(r=>r.id===rule.id?{...r,active:!r.active}:r))} style={{padding:"5px 12px",background:"var(--bg)",border:"1px solid var(--bd)",borderRadius:8,fontSize:11,color:"var(--t3)",cursor:"pointer"}}>
                {rule.active?"Pause":"Activate"}
              </button>
              <button onClick={()=>setEditRule(rule.id)} style={{padding:"5px 12px",background:"var(--bbg)",border:"1px solid var(--bbd)",borderRadius:8,fontSize:11,color:"var(--blue)",cursor:"pointer",fontWeight:600}}>Edit</button>
              <button onClick={()=>{if(window.confirm(`Delete "${rule.name}"?`))setRules(p=>p.filter(r=>r.id!==rule.id));}} style={{padding:"5px 10px",background:"var(--rbg)",border:"1px solid var(--rbd)",borderRadius:8,fontSize:11,color:"var(--red)",cursor:"pointer"}}>✕</button>
            </div>
          </div>);
        })}
      </div>}
    </>}

    {/* ── RECIPIENTS TAB ── */}
    {activeTab==="recipients"&&<>
      <RecipientForm/>
      {recipients.length===0?<div style={{textAlign:"center",padding:"32px",color:"var(--t4)",fontSize:13}}>No recipients yet. Add contacts above to start routing notifications.</div>
      :<div style={{display:"flex",flexDirection:"column",gap:8}}>
        {recipients.map(r=>(
          <div key={r.id} style={{background:"var(--white)",border:"1px solid var(--bd)",borderRadius:12,padding:"13px 18px",display:"flex",alignItems:"center",gap:14}}>
            <div style={{width:36,height:36,borderRadius:"50%",background:"linear-gradient(135deg,#3b82f6,#8b5cf6)",display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontSize:14,fontWeight:700,flexShrink:0}}>{r.name[0]}</div>
            <div style={{flex:1}}>
              <div style={{fontSize:13,fontWeight:700,color:"var(--t1)",marginBottom:2}}>{r.name} <span style={{fontSize:10,fontWeight:400,color:"var(--t4)"}}>· {r.role}</span></div>
              {r.email&&<div style={{fontSize:11,color:"var(--t3)"}}>✉️ {r.email}</div>}
              {r.phone&&<div style={{fontSize:11,color:"var(--t3)"}}>📱 {r.phone}</div>}
            </div>
            <div style={{fontSize:10,color:"var(--t4)"}}>{rules.filter(rule=>rule.recipientIds?.includes(r.id)).length} rule{rules.filter(rule=>rule.recipientIds?.includes(r.id)).length!==1?"s":""}</div>
            <button onClick={()=>setRecipients(p=>p.filter(x=>x.id!==r.id))} style={{padding:"5px 10px",background:"var(--rbg)",border:"1px solid var(--rbd)",borderRadius:8,fontSize:11,color:"var(--red)",cursor:"pointer"}}>✕</button>
          </div>
        ))}
      </div>}
    </>}

    {/* ── LOG TAB ── */}
    {activeTab==="log"&&<>
      <div style={{display:"flex",justifyContent:"flex-end",marginBottom:12}}>
        {alertLog.length>0&&<button onClick={()=>{if(window.confirm("Clear the entire send log?"))setAlertLog([]);}} style={{padding:"5px 14px",background:"var(--rbg)",border:"1px solid var(--rbd)",borderRadius:8,fontSize:11,color:"var(--red)",cursor:"pointer",fontWeight:600}}>Clear Log</button>}
      </div>
      {alertLog.length===0?<div style={{textAlign:"center",padding:"48px",color:"var(--t4)",fontSize:13}}>
        <div style={{fontSize:28,opacity:.15,marginBottom:8}}>📋</div>
        No notifications sent yet. Trigger notifications from the Live Alerts tab.
      </div>:<div style={{display:"flex",flexDirection:"column",gap:6}}>
        {alertLog.map(entry=>{
          const sm=SEVERITY_META[entry.severity];
          return(<div key={entry.id} style={{background:"var(--white)",border:"1px solid var(--bd)",borderRadius:10,padding:"11px 16px",display:"flex",alignItems:"center",gap:14}}>
            <span style={{fontSize:9,fontWeight:800,padding:"2px 8px",borderRadius:10,background:sm?.color||"var(--t4)",color:"#fff",letterSpacing:".07em",flexShrink:0}}>{(sm?.label||entry.severity).toUpperCase()}</span>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:12,fontWeight:600,color:"var(--t1)",marginBottom:1}}>{entry.loanAddr}</div>
              <div style={{fontSize:10,color:"var(--t3)"}}>{entry.detail}</div>
            </div>
            <div style={{fontSize:10,color:"var(--t4)",textAlign:"right",flexShrink:0}}>
              <div>{CHANNELS.find(c=>c.id===entry.channel)?.icon} {entry.channel}</div>
              <div>{fDateF(entry.ts.slice(0,10))}</div>
            </div>
          </div>);
        })}
      </div>}
    </>}

    {/* Modals */}
    {editRule&&<RuleEditor ruleId={editRule} onClose={()=>setEditRule(null)}/>}
    {previewAlert&&<PreviewModal alert={previewAlert} onClose={()=>{setPreviewAlert(null);setGeneratedMsg(null);setGeneratingMsg(false);}}/>}
  </div>);
}


function LoanDocAbstract({loans,onSelect}){
  const [selId,setSelId]=useState(String(loans[0]?.id||""));
  const [docMeta,setDocMeta]=useState({});   // {loanId:[{id,name,size,pages,uploadedAt}]}
  const [chat,setChat]=useState({});          // {loanId:[{role,content,ts}]}
  const [loaded,setLoaded]=useState(false);
  const [tab,setTab]=useState("docs");
  const [input,setInput]=useState("");
  const [thinking,setThinking]=useState(false);
  const [uploading,setUploading]=useState(false);
  const [dragOver,setDragOver]=useState(false);
  const chatEndRef=React.useRef(null);
  const fileInputRef=React.useRef(null);

  // Load metadata + chat from storage (docs stored individually by id)
  useEffect(()=>{(async()=>{
    try{
      const m=await supaStorage.get("meridian-adocmeta");
      if(m?.value)setDocMeta(JSON.parse(m.value));
      const c=await supaStorage.get("meridian-achat");
      if(c?.value)setChat(JSON.parse(c.value));
    }catch{}
    setLoaded(true);
  })();},[]);
  useEffect(()=>{if(!loaded)return;(async()=>{try{await supaStorage.set("meridian-adocmeta",JSON.stringify(docMeta));}catch{}})();},[docMeta,loaded]);
  useEffect(()=>{if(!loaded)return;(async()=>{try{await supaStorage.set("meridian-achat",JSON.stringify(chat));}catch{}})();},[chat,loaded]);
  useEffect(()=>{chatEndRef.current?.scrollIntoView({behavior:"smooth"});},[chat,selId,tab]);

  const sel=loans.find(l=>String(l.id)===selId);
  const el=sel?enrich(sel):null;
  const myDocs=docMeta[selId]||[];
  const myChat=chat[selId]||[];

  // Upload handler
  const handleFiles=async files=>{
    const arr=Array.from(files).filter(f=>f.type==="application/pdf"||f.name.endsWith(".pdf"));
    if(!arr.length){alert("Please upload PDF files only.");return;}
    setUploading(true);
    for(const file of arr){
      if(file.size>4.5*1024*1024){alert(`${file.name} exceeds 4.5MB limit. Please compress before uploading.`);continue;}
      const docId=`doc_${Date.now()}_${Math.random().toString(36).slice(2,7)}`;
      const b64=await new Promise((res,rej)=>{
        const r=new FileReader();
        r.onload=e=>res(e.target.result.split(",")[1]);
        r.onerror=rej;
        r.readAsDataURL(file);
      });
      // Store base64 data by docId
      try{await supaStorage.set(`meridian-adoc-${docId}`,b64);}
      catch{alert(`Could not store ${file.name} — file may be too large.`);continue;}
      // Add metadata
      setDocMeta(p=>({...p,[selId]:[...(p[selId]||[]),{id:docId,name:file.name,size:file.size,uploadedAt:new Date().toISOString().slice(0,10)}]}));
    }
    setUploading(false);
  };

  const deleteDoc=async docId=>{
    try{await supaStorage.delete(`meridian-adoc-${docId}`);}catch{}
    setDocMeta(p=>({...p,[selId]:(p[selId]||[]).filter(d=>d.id!==docId)}));
  };

  const clearChat=()=>setChat(p=>({...p,[selId]:[]}));

  // Send message to AI
  const sendMessage=async(userText)=>{
    const msg=userText||input.trim();
    if(!msg||thinking)return;
    if(myDocs.length===0){alert("Upload at least one loan document first.");return;}
    setInput("");
    const userMsg={role:"user",content:msg,ts:Date.now()};
    setChat(p=>({...p,[selId]:[...(p[selId]||[]),userMsg]}));
    setThinking(true);
    setTab("chat");

    try{
      // Load all doc base64 data
      const docData=[];
      for(const d of myDocs){
        try{
          const r=await supaStorage.get(`meridian-adoc-${d.id}`);
          if(r?.value)docData.push({...d,data:r.value});
        }catch{}
      }

      // Build loan context string
      const loanCtx=sel?`
Loan: ${sel.addr}
Lender: ${sel.lender} (${sel.lenderType})
Type: ${sel.loanType} | Rate: ${fPct(sel.rate)} | Balance: ${f$(el.origBalance)}
Maturity: ${sel.maturityDate} | Term: ${sel.termYears}yr | Amort: ${sel.amortYears||"IO"}yr
Prepay: ${sel.prepay||"None"} | Recourse: ${sel.recourse?"Yes":"Non-Recourse"}
${sel.annualNOI?`NOI: ${f$(sel.annualNOI)} | DSCR: ${el.dscr?.toFixed(2)+"x" || "—"}`:""}
${sel.dscrCovenant?`Covenant: ${sel.dscrCovenant}x`:""}
${sel.notes?`Notes: ${sel.notes}`:""}`.trim():"";

      // System prompt
      const systemPrompt=`You are a specialized mortgage loan analyst for Meridian Properties, a Brooklyn multifamily portfolio. You have been given the loan documents for ${sel?.addr||"this property"} and full access to the loan data below.

${loanCtx}

You can:
- Extract and summarize key loan terms directly from the documents
- Flag risks, unusual clauses, covenants, triggers, or springing recourse provisions
- Compare what the documents say vs. what's recorded in the system
- Answer specific questions about interest calculations, prepayment language, default provisions, extension options
- Surface anything the borrower should know before maturity or refinancing

Be precise. Quote specific document language when relevant. Flag discrepancies between the uploaded documents and recorded loan data.`;

      // Build messages: docs as first user turn context, then history, then new message
      const historyPairs=(myChat).slice(-8); // last 8 messages for context window
      const contentBlocks=[
        ...docData.map(d=>({type:"document",source:{type:"base64",media_type:"application/pdf",data:d.data}})),
        {type:"text",text:`[Loan documents loaded: ${docData.map(d=>d.name).join(", ")}]\n\nUser question: ${msg}`}
      ];

      const messages=[
        {role:"user",content:contentBlocks},
        // If there's prior conversation, inject it as context after the docs
        ...(historyPairs.length>0?[{
          role:"assistant",
          content:`I have reviewed the loan documents (${docData.map(d=>d.name).join(", ")}) for ${sel?.addr}. I'm ready to answer your questions about this loan.`
        }]:[]),
        ...historyPairs.slice(historyPairs.length>0?0:0).reduce((acc,m,i,arr)=>{
          // Re-inject conversation turns without the docs
          if(i===arr.length-1)return acc; // skip last user message, already in contentBlocks
          if(m.role==="user"&&i<arr.length-1)return[...acc,{role:"user",content:m.content}];
          if(m.role==="assistant")return[...acc,{role:"assistant",content:m.content}];
          return acc;
        },[]),
      ];

      const resp=await fetch("https://api.anthropic.com/v1/messages",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          model:"claude-sonnet-4-20250514",
          max_tokens:1000,
          system:systemPrompt,
          messages,
        })
      });
      const data=await resp.json();
      const aiText=data.content?.filter(b=>b.type==="text").map(b=>b.text).join("\n")||"I couldn't generate a response. Please try again.";
      const aiMsg={role:"assistant",content:aiText,ts:Date.now()};
      setChat(p=>({...p,[selId]:[...(p[selId]||[]),aiMsg]}));
    }catch(e){
      const errMsg={role:"assistant",content:`Error: ${e.message||"Something went wrong. Please try again."}`,ts:Date.now(),error:true};
      setChat(p=>({...p,[selId]:[...(p[selId]||[]),errMsg]}));
    }
    setThinking(false);
  };

  const SUGGESTED=[
    "Summarize the key loan terms from the documents",
    "What are the prepayment provisions and exact penalty calculation?",
    "Are there any financial covenants or reporting requirements?",
    "What events could trigger a default or springing recourse?",
    "What are the extension option requirements and conditions?",
    "Flag any unusual or risky clauses I should be aware of",
    "What does the document say about permitted transfers or assumptions?",
    "Compare the document terms to what's recorded in the system",
  ];

  const fSize=b=>b>1e6?`${(b/1e6).toFixed(1)}MB`:`${Math.round(b/1024)}KB`;

  if(loans.length===0)return(<div style={{padding:"64px 40px",textAlign:"center"}}>
    <div style={{fontSize:32,opacity:.2,marginBottom:12}}>📄</div>
    <div style={{fontSize:16,fontWeight:700,color:"var(--t3)"}}>Add loans first to start uploading documents.</div>
  </div>);

  return(<div style={{display:"grid",gridTemplateColumns:"240px 1fr",gap:0,height:"calc(100vh - 58px - 48px)",minHeight:500}}>

    {/* ── LEFT: Loan selector ── */}
    <div style={{borderRight:"1px solid var(--bd)",background:"var(--white)",display:"flex",flexDirection:"column",overflow:"hidden"}}>
      <div style={{padding:"12px 14px",borderBottom:"1px solid var(--bd)",background:"var(--bg)"}}>
        <div style={{fontSize:10,fontWeight:800,color:"var(--t3)",textTransform:"uppercase",letterSpacing:".1em",marginBottom:2}}>Select Loan</div>
        <div style={{fontSize:11,color:"var(--t4)"}}>{loans.length} properties</div>
      </div>
      <div style={{flex:1,overflowY:"auto"}}>
        {loans.map(l=>{
          const cnt=(docMeta[String(l.id)]||[]).length;
          const msgs=(chat[String(l.id)]||[]).length;
          const isActive=String(l.id)===selId;
          const el2=enrich(l);
          return(<div key={l.id} onClick={()=>setSelId(String(l.id))}
            style={{padding:"11px 14px",cursor:"pointer",borderBottom:"1px solid var(--bd)",borderLeft:`3px solid ${isActive?"var(--blue)":"transparent"}`,background:isActive?"var(--bbg)":"transparent",transition:"all .1s"}}>
            <div style={{fontSize:11,fontWeight:700,color:isActive?"var(--blue)":"var(--t1)",marginBottom:3,lineHeight:1.3}}>{l.addr}</div>
            <div style={{fontSize:10,color:"var(--t3)",marginBottom:4}}>{l.lender} · {fPct(l.rate)}</div>
            <div style={{display:"flex",gap:8}}>
              <span style={{fontSize:9,padding:"2px 7px",borderRadius:10,background:cnt>0?"var(--bbg)":"var(--bg)",color:cnt>0?"var(--blue)":"var(--t4)",border:`1px solid ${cnt>0?"var(--bbd)":"var(--bd)"}`,fontWeight:600}}>
                📄 {cnt} doc{cnt!==1?"s":""}
              </span>
              {msgs>0&&<span style={{fontSize:9,padding:"2px 7px",borderRadius:10,background:"var(--gbg)",color:"var(--green)",border:"1px solid var(--gbd)",fontWeight:600}}>
                💬 {msgs}
              </span>}
            </div>
          </div>);
        })}
      </div>
    </div>

    {/* ── RIGHT: Docs + Chat ── */}
    <div style={{display:"flex",flexDirection:"column",overflow:"hidden",background:"var(--bg)"}}>

      {/* Header */}
      {sel&&<div style={{padding:"14px 20px",borderBottom:"1px solid var(--bd)",background:"var(--white)",display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0}}>
        <div>
          <div style={{fontSize:15,fontWeight:800,color:"var(--t1)"}}>{sel.addr}</div>
          <div style={{fontSize:11,color:"var(--t3)"}}>{sel.lender} · {fPct(sel.rate)} {sel.loanType} · Matures {fDateS(sel.maturityDate)}</div>
        </div>
        <div style={{display:"flex",gap:6}}>
          {/* Tab toggle */}
          <div style={{display:"flex",gap:2,background:"var(--bg)",border:"1px solid var(--bd)",borderRadius:9,padding:2}}>
            {[["docs",`📄 Documents (${myDocs.length})`],["chat","🤖 AI Chat"]].map(([id,lbl])=>(
              <button key={id} onClick={()=>setTab(id)} style={{padding:"6px 14px",borderRadius:7,border:"none",fontSize:11,fontWeight:tab===id?700:400,background:tab===id?"var(--t1)":"transparent",color:tab===id?"#fff":"var(--t3)",cursor:"pointer",whiteSpace:"nowrap"}}>{lbl}</button>
            ))}
          </div>
          {tab==="chat"&&myChat.length>0&&<button onClick={clearChat} style={{padding:"6px 12px",background:"var(--rbg)",border:"1px solid var(--rbd)",borderRadius:9,fontSize:11,color:"var(--red)",cursor:"pointer",fontWeight:600}}>Clear Chat</button>}
        </div>
      </div>}

      {/* ── DOCS TAB ── */}
      {tab==="docs"&&<div style={{flex:1,overflowY:"auto",padding:20}}>

        {/* Drop zone */}
        <div
          onDragOver={e=>{e.preventDefault();setDragOver(true);}}
          onDragLeave={()=>setDragOver(false)}
          onDrop={e=>{e.preventDefault();setDragOver(false);handleFiles(e.dataTransfer.files);}}
          onClick={()=>fileInputRef.current?.click()}
          style={{border:`2px dashed ${dragOver?"var(--blue)":"var(--bd2)"}`,borderRadius:14,padding:"36px 24px",textAlign:"center",cursor:"pointer",marginBottom:20,background:dragOver?"var(--bbg)":"var(--white)",transition:"all .15s"}}>
          <input ref={fileInputRef} type="file" accept=".pdf,application/pdf" multiple style={{display:"none"}} onChange={e=>handleFiles(e.target.files)}/>
          <div style={{fontSize:32,marginBottom:10,opacity:.4}}>{uploading?"⏳":"📤"}</div>
          <div style={{fontSize:14,fontWeight:700,color:"var(--t1)",marginBottom:4}}>{uploading?"Uploading…":"Drop PDFs here or click to upload"}</div>
          <div style={{fontSize:11,color:"var(--t3)"}}>Loan agreements, notes, appraisals, title policies, environmental — any PDF up to 4.5MB</div>
        </div>

        {/* Doc list */}
        {myDocs.length===0?<div style={{textAlign:"center",padding:"32px",color:"var(--t4)",fontSize:13}}>
          No documents uploaded for this loan yet.
        </div>:<div style={{display:"flex",flexDirection:"column",gap:8}}>
          {myDocs.map(d=>(
            <div key={d.id} style={{background:"var(--white)",border:"1px solid var(--bd)",borderRadius:12,padding:"13px 16px",display:"flex",alignItems:"center",gap:14}}>
              <div style={{fontSize:26,flexShrink:0}}>📕</div>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:12,fontWeight:700,color:"var(--t1)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{d.name}</div>
                <div style={{fontSize:10,color:"var(--t3)",marginTop:2}}>Uploaded {d.uploadedAt} · {fSize(d.size)}</div>
              </div>
              <button onClick={()=>setTab("chat")} style={{padding:"5px 14px",background:"var(--bbg)",border:"1px solid var(--bbd)",borderRadius:8,fontSize:11,color:"var(--blue)",cursor:"pointer",fontWeight:600,whiteSpace:"nowrap"}}>Ask AI →</button>
              <button onClick={()=>deleteDoc(d.id)} style={{padding:"5px 10px",background:"var(--rbg)",border:"1px solid var(--rbd)",borderRadius:8,fontSize:11,color:"var(--red)",cursor:"pointer",fontWeight:600}}>✕</button>
            </div>
          ))}
        </div>}

        {myDocs.length>0&&<div style={{marginTop:16,padding:"12px 16px",background:"var(--bbg)",border:"1px solid var(--bbd)",borderRadius:12}}>
          <div style={{fontSize:11,fontWeight:700,color:"var(--blue)",marginBottom:4}}>✅ {myDocs.length} document{myDocs.length!==1?"s":""} ready for AI analysis</div>
          <div style={{fontSize:11,color:"var(--t3)"}}>Switch to the AI Chat tab to ask questions about these documents.</div>
          <button onClick={()=>setTab("chat")} style={{marginTop:8,padding:"6px 16px",background:"var(--t1)",border:"none",borderRadius:8,color:"#fff",fontSize:12,fontWeight:600,cursor:"pointer"}}>Open AI Chat →</button>
        </div>}
      </div>}

      {/* ── CHAT TAB ── */}
      {tab==="chat"&&<div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>

        {/* Messages */}
        <div style={{flex:1,overflowY:"auto",padding:"16px 20px",display:"flex",flexDirection:"column",gap:12}}>

          {myChat.length===0&&<>
            {/* Welcome state */}
            <div style={{background:"var(--white)",border:"1px solid var(--bd)",borderRadius:16,padding:"24px 28px",marginBottom:8}}>
              <div style={{fontSize:18,marginBottom:10}}>🤖</div>
              <div style={{fontSize:14,fontWeight:700,color:"var(--t1)",marginBottom:6}}>AI Loan Document Analyst</div>
              <div style={{fontSize:12,color:"var(--t3)",lineHeight:1.7}}>
                {myDocs.length===0
                  ?<>Upload loan documents on the <strong>Documents tab</strong> first. Once uploaded, I can extract key terms, flag risks, explain provisions, and answer any question about this loan's paperwork.</>
                  :<>I have access to <strong>{myDocs.length} document{myDocs.length!==1?"s":""}</strong> for <strong>{sel?.addr}</strong>. Ask me anything about this loan's terms, covenants, prepayment language, default provisions, or anything else in the paperwork.</>
                }
              </div>
              {myDocs.length===0&&<button onClick={()=>setTab("docs")} style={{marginTop:12,padding:"7px 18px",background:"var(--t1)",border:"none",borderRadius:9,color:"#fff",fontSize:12,fontWeight:600,cursor:"pointer"}}>Upload Documents →</button>}
            </div>

            {/* Suggested questions */}
            {myDocs.length>0&&<>
              <div style={{fontSize:10,fontWeight:700,color:"var(--t4)",textTransform:"uppercase",letterSpacing:".1em",marginBottom:4}}>Suggested Questions</div>
              <div style={{display:"flex",flexDirection:"column",gap:6}}>
                {SUGGESTED.map((q,i)=>(
                  <button key={i} onClick={()=>sendMessage(q)}
                    style={{textAlign:"left",padding:"10px 14px",background:"var(--white)",border:"1px solid var(--bd)",borderRadius:10,fontSize:12,color:"var(--t2)",cursor:"pointer",transition:"all .12s",display:"flex",alignItems:"center",gap:10}}
                    onMouseEnter={e=>{e.currentTarget.style.borderColor="var(--blue)";e.currentTarget.style.color="var(--blue)";}}
                    onMouseLeave={e=>{e.currentTarget.style.borderColor="var(--bd)";e.currentTarget.style.color="var(--t2)";}}>
                    <span style={{color:"var(--t4)",fontSize:11}}>↗</span>{q}
                  </button>
                ))}
              </div>
            </>}
          </>}

          {/* Chat messages */}
          {myChat.map((m,i)=>(
            <div key={i} style={{display:"flex",justifyContent:m.role==="user"?"flex-end":"flex-start",gap:10,alignItems:"flex-start"}}>
              {m.role==="assistant"&&<div style={{width:28,height:28,borderRadius:"50%",background:"linear-gradient(135deg,#3b82f6,#8b5cf6)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,flexShrink:0,marginTop:2}}>🤖</div>}
              <div style={{
                maxWidth:"80%",padding:"12px 16px",borderRadius:m.role==="user"?"14px 14px 4px 14px":"14px 14px 14px 4px",
                background:m.role==="user"?"var(--t1)":m.error?"var(--rbg)":"var(--white)",
                color:m.role==="user"?"#fff":m.error?"var(--red)":"var(--t1)",
                border:m.role==="user"?"none":m.error?"1px solid var(--rbd)":"1px solid var(--bd)",
                fontSize:13,lineHeight:1.7,whiteSpace:"pre-wrap",
              }}>{m.content}</div>
              {m.role==="user"&&<div style={{width:28,height:28,borderRadius:"50%",background:"var(--t1)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,color:"#fff",fontWeight:700,flexShrink:0,marginTop:2}}>M</div>}
            </div>
          ))}

          {/* Thinking indicator */}
          {thinking&&<div style={{display:"flex",alignItems:"flex-start",gap:10}}>
            <div style={{width:28,height:28,borderRadius:"50%",background:"linear-gradient(135deg,#3b82f6,#8b5cf6)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,flexShrink:0}}>🤖</div>
            <div style={{padding:"12px 18px",background:"var(--white)",border:"1px solid var(--bd)",borderRadius:"14px 14px 14px 4px",display:"flex",gap:5,alignItems:"center"}}>
              {[0,1,2].map(i=><div key={i} style={{width:7,height:7,borderRadius:"50%",background:"var(--t4)",animation:`pulse 1.4s ease-in-out ${i*0.2}s infinite`}}/>)}
            </div>
          </div>}

          <div ref={chatEndRef}/>
        </div>

        {/* Suggested chips (when chat has messages) */}
        {myChat.length>0&&myDocs.length>0&&!thinking&&<div style={{padding:"8px 20px 0",display:"flex",gap:6,flexWrap:"wrap",flexShrink:0}}>
          {SUGGESTED.slice(0,4).map((q,i)=>(
            <button key={i} onClick={()=>sendMessage(q)}
              style={{padding:"5px 12px",background:"var(--white)",border:"1px solid var(--bd)",borderRadius:20,fontSize:10,color:"var(--t3)",cursor:"pointer",whiteSpace:"nowrap",transition:"all .12s"}}
              onMouseEnter={e=>{e.currentTarget.style.borderColor="var(--blue)";e.currentTarget.style.color="var(--blue)";}}
              onMouseLeave={e=>{e.currentTarget.style.borderColor="var(--bd)";e.currentTarget.style.color="var(--t3)";}}>
              {q.slice(0,40)}{q.length>40?"…":""}
            </button>
          ))}
        </div>}

        {/* Input bar */}
        <div style={{padding:"12px 20px 16px",flexShrink:0,borderTop:"1px solid var(--bd)",background:"var(--white)"}}>
          {myDocs.length===0&&<div style={{fontSize:11,color:"var(--amber)",fontWeight:600,marginBottom:8,display:"flex",alignItems:"center",gap:6}}>
            ⚠️ No documents uploaded — <span style={{cursor:"pointer",textDecoration:"underline"}} onClick={()=>setTab("docs")}>upload PDFs first</span>
          </div>}
          <div style={{display:"flex",gap:8,alignItems:"flex-end"}}>
            <textarea
              value={input}
              onChange={e=>setInput(e.target.value)}
              onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();sendMessage();}}}
              placeholder={myDocs.length>0?"Ask anything about this loan's documents… (Enter to send, Shift+Enter for new line)":"Upload documents to start chatting…"}
              disabled={myDocs.length===0||thinking}
              rows={2}
              style={{flex:1,padding:"10px 14px",background:"var(--bg)",border:"1px solid var(--bd2)",borderRadius:12,fontSize:13,color:"var(--t1)",outline:"none",resize:"none",fontFamily:"inherit",lineHeight:1.5,opacity:myDocs.length===0?.5:1}}
            />
            <button onClick={()=>sendMessage()} disabled={!input.trim()||thinking||myDocs.length===0}
              style={{padding:"10px 18px",background:!input.trim()||thinking||myDocs.length===0?"var(--bd2)":"var(--t1)",border:"none",borderRadius:12,color:"#fff",fontSize:13,fontWeight:700,cursor:!input.trim()||thinking?"default":"pointer",transition:"all .15s",flexShrink:0,alignSelf:"stretch"}}>
              {thinking?"…":"↑"}
            </button>
          </div>
          <div style={{fontSize:9,color:"var(--t4)",marginTop:6,textAlign:"right"}}>Powered by Claude · Documents stay in your browser · Not sent to any third party except Anthropic API</div>
        </div>
      </div>}
    </div>

    <style>{`@keyframes pulse{0%,60%,100%{opacity:.25}30%{opacity:1}}`}</style>
  </div>);
}


/* ─────────── CONTACTS VIEW (standalone) ─────────── */
function ContactsView({loans,onSelect}){
  const [selId,setSelId]=useState(String(loans[0]?.id||""));
  const [contacts,setContacts]=useState({});
  const [loaded,setLoaded]=useState(false);
  const [showAdd,setShowAdd]=useState(false);
  const blank={role:"Servicer",name:"",company:"",phone:"",email:"",notes:""};
  const [nc,setNc]=useState(blank);

  useEffect(()=>{(async()=>{try{const r=await supaStorage.get("meridian-contacts");if(r?.value)setContacts(JSON.parse(r.value));}catch{}setLoaded(true);})();},[]);
  useEffect(()=>{if(!loaded)return;(async()=>{try{await supaStorage.set("meridian-contacts",JSON.stringify(contacts));}catch{}})();},[contacts,loaded]);

  const sel=loans.find(l=>String(l.id)===selId);
  const cur=contacts[selId]||[];
  const addC=()=>{if(!nc.name)return;setContacts(p=>({...p,[selId]:[...(p[selId]||[]),{...nc,id:Date.now()}]}));setNc(blank);setShowAdd(false);};
  const delC=id=>setContacts(p=>({...p,[selId]:(p[selId]||[]).filter(c=>c.id!==id)}));
  const roleIcon=r=>r==="Servicer"?"🏦":r==="Broker"?"🤝":r==="Attorney"?"⚖️":r==="Appraiser"?"🏠":r==="Insurance Agent"?"🛡️":"👤";
  const totalC=Object.values(contacts).reduce((s,a)=>s+a.length,0);

  if(loans.length===0)return(<div style={{padding:"64px 40px",textAlign:"center"}}><div style={{fontSize:32,opacity:.2,marginBottom:12}}>👤</div><div style={{fontSize:16,fontWeight:700,color:"var(--t3)"}}>Add loans first.</div></div>);

  return(<div>
    <div style={{marginBottom:20}}>
      <div style={{fontSize:22,fontWeight:700,color:"var(--t1)",marginBottom:4}}>Contacts</div>
      <div style={{fontSize:13,color:"var(--t3)"}}>{totalC} contact{totalC!==1?"s":""} stored · Servicers, brokers, attorneys, lenders — linked per property.</div>
    </div>
    <div style={{display:"grid",gridTemplateColumns:"240px 1fr",gap:16,alignItems:"start"}}>
      {/* Loan selector */}
      <div style={{background:"var(--white)",border:"1px solid var(--bd)",borderRadius:14,overflow:"hidden",position:"sticky",top:0}}>
        <div style={{padding:"11px 14px",borderBottom:"1px solid var(--bd)",fontSize:10,fontWeight:700,color:"var(--t3)",textTransform:"uppercase",letterSpacing:".07em"}}>Property</div>
        <div style={{maxHeight:520,overflowY:"auto"}}>
          {loans.map(l=>{const cnt=(contacts[String(l.id)]||[]).length;const isA=String(l.id)===selId;
            return(<div key={l.id} onClick={()=>setSelId(String(l.id))} style={{padding:"10px 14px",cursor:"pointer",borderLeft:`2px solid ${isA?"var(--blue)":"transparent"}`,background:isA?"var(--bbg)":"transparent",borderBottom:"1px solid var(--bd)",transition:"all .1s"}}>
              <div style={{fontSize:11,fontWeight:700,color:isA?"var(--blue)":"var(--t1)",marginBottom:2,lineHeight:1.3}}>{l.addr}</div>
              <div style={{fontSize:9,color:cnt>0?"var(--green)":"var(--t4)"}}>{cnt>0?`${cnt} contact${cnt!==1?"s":""}`:"No contacts"}</div>
            </div>);
          })}
        </div>
      </div>
      {/* Detail */}
      <div>
        {sel&&<>
          <div style={{background:"var(--white)",border:"1px solid var(--bd)",borderRadius:14,padding:"14px 18px",marginBottom:14,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div>
              <div style={{fontSize:15,fontWeight:800,color:"var(--t1)"}}>{sel.addr}</div>
              <div style={{fontSize:11,color:"var(--t3)"}}>{sel.lender} · {fPct(sel.rate)} · {cur.length} contact{cur.length!==1?"s":""}</div>
            </div>
            <button className="btn-dark" onClick={()=>setShowAdd(s=>!s)}>+ Add Contact</button>
          </div>
          {showAdd&&<div style={{background:"var(--white)",border:"1px solid var(--bd)",borderRadius:14,padding:"18px 20px",marginBottom:14,boxShadow:"0 4px 16px rgba(0,0,0,.07)"}}>
            <div style={{fontSize:13,fontWeight:700,color:"var(--t1)",marginBottom:12}}>New Contact</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
              <div><div className="flbl" style={{display:"block",marginBottom:3}}>Name *</div><input className="finp" value={nc.name} onChange={e=>setNc(p=>({...p,name:e.target.value}))} placeholder="Jane Smith"/></div>
              <div><div className="flbl" style={{display:"block",marginBottom:3}}>Role</div><select className="finp" value={nc.role} onChange={e=>setNc(p=>({...p,role:e.target.value}))}>{CONTACT_ROLES.map(r=><option key={r}>{r}</option>)}</select></div>
              <div><div className="flbl" style={{display:"block",marginBottom:3}}>Company</div><input className="finp" value={nc.company} onChange={e=>setNc(p=>({...p,company:e.target.value}))} placeholder="Meridian Capital"/></div>
              <div><div className="flbl" style={{display:"block",marginBottom:3}}>Phone</div><input className="finp" value={nc.phone} onChange={e=>setNc(p=>({...p,phone:e.target.value}))} placeholder="+1 212 555 0100"/></div>
              <div><div className="flbl" style={{display:"block",marginBottom:3}}>Email</div><input className="finp" value={nc.email} onChange={e=>setNc(p=>({...p,email:e.target.value}))} placeholder="jane@firm.com"/></div>
              <div><div className="flbl" style={{display:"block",marginBottom:3}}>Notes</div><input className="finp" value={nc.notes} onChange={e=>setNc(p=>({...p,notes:e.target.value}))} placeholder="Preferred contact for extensions"/></div>
            </div>
            <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}><button className="btn-light" onClick={()=>{setShowAdd(false);setNc(blank);}}>Cancel</button><button className="btn-dark" onClick={addC}>Save</button></div>
          </div>}
          {cur.length===0&&!showAdd?<div style={{background:"var(--white)",border:"2px dashed var(--bd2)",borderRadius:14,padding:"48px 24px",textAlign:"center"}}>
            <div style={{fontSize:28,opacity:.15,marginBottom:8}}>👤</div>
            <div style={{fontSize:13,fontWeight:600,color:"var(--t3)",marginBottom:4}}>No contacts for this property</div>
            <div style={{fontSize:11,color:"var(--t4)"}}>Add servicers, brokers, attorneys, and key contacts.</div>
          </div>:<div style={{display:"flex",flexDirection:"column",gap:8}}>
            {cur.map(c=>(
              <div key={c.id} style={{background:"var(--white)",border:"1px solid var(--bd)",borderRadius:12,padding:"14px 18px",display:"flex",gap:14,alignItems:"flex-start"}}>
                <div style={{width:38,height:38,borderRadius:"50%",background:"var(--bg)",border:"1px solid var(--bd)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,flexShrink:0}}>{roleIcon(c.role)}</div>
                <div style={{flex:1}}>
                  <div style={{fontSize:13,fontWeight:700,color:"var(--t1)",marginBottom:2}}>{c.name}</div>
                  {c.company&&<div style={{fontSize:11,color:"var(--t3)",marginBottom:4}}>{c.company}</div>}
                  <span style={{fontSize:9,fontWeight:700,padding:"2px 8px",borderRadius:20,background:"var(--bbg)",color:"var(--blue)",border:"1px solid var(--bbd)"}}>{c.role}</span>
                  <div style={{marginTop:8,display:"flex",flexDirection:"column",gap:4}}>
                    {c.phone&&<div style={{display:"flex",alignItems:"center",gap:6}}><span style={{fontSize:11,color:"var(--t4)"}}>📞</span><a href={`tel:${c.phone}`} style={{fontSize:11,color:"var(--blue)",textDecoration:"none"}}>{c.phone}</a><CopyBtn text={c.phone}/></div>}
                    {c.email&&<div style={{display:"flex",alignItems:"center",gap:6}}><span style={{fontSize:11,color:"var(--t4)"}}>✉️</span><a href={`mailto:${c.email}`} style={{fontSize:11,color:"var(--blue)",textDecoration:"none",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:280}}>{c.email}</a><CopyBtn text={c.email}/></div>}
                  </div>
                  {c.notes&&<div style={{marginTop:8,fontSize:10,color:"var(--t3)",lineHeight:1.5,borderTop:"1px solid var(--bd)",paddingTop:8}}>{c.notes}</div>}
                </div>
                <button onClick={()=>delC(c.id)} style={{background:"none",border:"none",cursor:"pointer",fontSize:12,color:"var(--t4)",padding:"2px 6px"}}>✕</button>
              </div>
            ))}
          </div>}
        </>}
      </div>
    </div>
  </div>);
}

/* ─────────── IMG SLOT (lazy signed-URL loader) ─────────── */
function ImgSlot({f, getUrl, onLightbox}){
  const [src,setSrc]=useState(f.data||null); // use base64 immediately if available
  useEffect(()=>{
    if(!src&&f.storagePath){
      getUrl(f.storagePath,f.id).then(url=>{if(url)setSrc(url);});
    }
  },[f.storagePath,f.id]);
  if(!src)return(<div style={{width:"100%",paddingTop:"56%",position:"relative",borderRadius:6,background:"var(--bg)",display:"flex",alignItems:"center",justifyContent:"center"}}>
    <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,color:"var(--t4)"}}>Loading…</div>
  </div>);
  return(<div onClick={()=>onLightbox({src,name:f.name})} style={{width:"100%",paddingTop:"56%",position:"relative",borderRadius:6,overflow:"hidden",cursor:"pointer",background:"var(--bg)"}}>
    <img src={src} alt={f.name} style={{position:"absolute",inset:0,width:"100%",height:"100%",objectFit:"cover"}}/>
  </div>);
}

/* ─────────── DOCUMENTS VIEW (full building grid + slots) ─────────── */
const DOC_SLOTS=[
  {id:"loan_agreement",label:"Loan Agreement",icon:"📋",required:true},
  {id:"promissory_note",label:"Promissory Note",icon:"✍️",required:true},
  {id:"appraisal",label:"Appraisal",icon:"🏠",required:true},
  {id:"title_policy",label:"Title Policy",icon:"🔏",required:true},
  {id:"survey",label:"Survey",icon:"📐",required:false},
  {id:"environmental",label:"Environmental",icon:"🌿",required:false},
  {id:"insurance",label:"Insurance",icon:"🛡️",required:false},
  {id:"tax_records",label:"Tax Records",icon:"📊",required:false},
  {id:"photos",label:"Property Photos",icon:"📷",required:false},
  {id:"other",label:"Other",icon:"📎",required:false},
];

function DocumentsView({loans}){
  const [docs,setDocs]=useState({});  // {loanId:{slotId:[{id,name,size,type,data,uploadedAt}]}}
  const [loaded,setLoaded]=useState(false);
  const [uploadingSlot,setUploadingSlot]=useState(null); // "loanId-slotId"
  const [expandedLoan,setExpandedLoan]=useState(null);
  const [lightbox,setLightbox]=useState(null); // {src,name}
  const [searchQ,setSearchQ]=useState("");
  const [filterMissing,setFilterMissing]=useState(false);
  const fileRefs=React.useRef({});

  // docs state: {loanId: {slotId: [{id, name, size, type, storagePath, uploadedAt}]}}
  // Files live in Supabase Storage; metadata lives in user_storage table
  useEffect(()=>{(async()=>{
    try{const r=await supaStorage.get("meridian-propdocs");if(r?.value)setDocs(JSON.parse(r.value));}catch{}
    setLoaded(true);
  })();},[]);
  useEffect(()=>{if(!loaded)return;(async()=>{
    // Save metadata only (no base64 blobs)
    try{await supaStorage.set("meridian-propdocs",JSON.stringify(docs));}catch{}
  })();},[docs,loaded]);

  // Signed URL cache so we don't re-fetch on every render
  const [urlCache,setUrlCache]=useState({});
  const getUrl=useCallback(async(storagePath,fileId)=>{
    if(urlCache[fileId])return urlCache[fileId];
    if(!storagePath)return null;
    const url=await supaStorage.getFileURL(storagePath);
    if(url)setUrlCache(p=>({...p,[fileId]:url}));
    return url;
  },[urlCache]);

  const uploadFile=async(loanId,slotId,file)=>{
    if(file.size>10*1024*1024){alert("File must be under 10MB.");return;}
    const key=`${loanId}-${slotId}`;
    setUploadingSlot(key);
    try{
      const fileId=Date.now();
      const ext=file.name.split(".").pop();
      const storagePath=`docs/${loanId}/${slotId}/${fileId}.${ext}`;
      // Upload to Supabase Storage
      const uploadedPath=await supaStorage.uploadFile(storagePath,file,file.type);
      // Fall back to base64 if Supabase not configured (local mode)
      let fallbackData=null;
      if(!uploadedPath){
        fallbackData=await new Promise((res,rej)=>{const r=new FileReader();r.onload=e=>res(e.target.result);r.onerror=rej;r.readAsDataURL(file);});
      }
      const entry={id:fileId,name:file.name,size:file.size,type:file.type,storagePath:uploadedPath||null,data:fallbackData,uploadedAt:TODAY_STR};
      setDocs(p=>{
        const lDocs={...(p[loanId]||{})};
        lDocs[slotId]=[...(lDocs[slotId]||[]),entry];
        return{...p,[loanId]:lDocs};
      });
    }catch(e){alert(`Upload failed: ${e.message}`);}
    setUploadingSlot(null);
  };

  const deleteFile=async(loanId,slotId,fileId)=>{
    // Find storagePath and remove from Supabase Storage
    const f=(docs[loanId]?.[slotId]||[]).find(x=>x.id===fileId);
    if(f?.storagePath)await supaStorage.deleteFile(f.storagePath);
    setDocs(p=>{
      const lDocs={...(p[loanId]||{})};
      lDocs[slotId]=(lDocs[slotId]||[]).filter(f=>f.id!==fileId);
      return{...p,[loanId]:lDocs};
    });
  };

  const downloadFile=async f=>{
    let url=f.data; // local fallback
    if(f.storagePath){url=await supaStorage.getFileURL(f.storagePath)||f.data;}
    if(!url)return;
    const a=document.createElement("a");a.href=url;a.download=f.name;a.target="_blank";a.click();
  };
  const fmtSize=b=>b>1e6?`${(b/1e6).toFixed(1)}MB`:b>1e3?`${(b/1024).toFixed(0)}KB`:`${b}B`;
  const isImg=t=>t&&t.startsWith("image/");

  const totalFiles=Object.values(docs).reduce((s,ld)=>s+Object.values(ld).reduce((s2,arr)=>s2+arr.length,0),0);
  const loansWithAllRequired=loans.filter(l=>{
    const ld=docs[l.id]||{};
    return DOC_SLOTS.filter(s=>s.required).every(s=>(ld[s.id]||[]).length>0);
  }).length;
  const loansMissingRequired=loans.filter(l=>{
    const ld=docs[l.id]||{};
    return DOC_SLOTS.filter(s=>s.required).some(s=>!(ld[s.id]||[]).length);
  }).length;

  const filteredLoans=loans.filter(l=>{
    if(searchQ&&!l.addr.toLowerCase().includes(searchQ.toLowerCase()))return false;
    if(filterMissing){const ld=docs[l.id]||{};return DOC_SLOTS.filter(s=>s.required).some(s=>!(ld[s.id]||[]).length);}
    return true;
  });

  return(<div>
    {/* Header */}
    <div style={{marginBottom:20}}>
      <div style={{fontSize:22,fontWeight:700,color:"var(--t1)",marginBottom:4}}>Property Documents</div>
      <div style={{fontSize:13,color:"var(--t3)"}}>Every building · Every required document · Upload once, access anywhere.</div>
    </div>

    {/* KPIs */}
    <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:20}}>
      {[
        {l:"Total Files",v:totalFiles,c:"var(--blue)",bg:"var(--bbg)",bd:"var(--bbd)"},
        {l:"Fully Documented",v:loansWithAllRequired,c:"var(--green)",bg:"var(--gbg)",bd:"var(--gbd)"},
        {l:"Missing Required Docs",v:loansMissingRequired,c:loansMissingRequired>0?"var(--red)":"var(--green)",bg:loansMissingRequired>0?"var(--rbg)":"var(--gbg)",bd:loansMissingRequired>0?"var(--rbd)":"var(--gbd)"},
        {l:"Total Buildings",v:loans.length,c:"var(--t1)",bg:"var(--white)",bd:"var(--bd)"},
      ].map((k,i)=><div key={i} style={{background:k.bg,border:`1px solid ${k.bd}`,borderRadius:12,padding:"14px 16px"}}>
        <div style={{fontSize:9,fontWeight:800,color:k.c,textTransform:"uppercase",letterSpacing:".07em",marginBottom:6}}>{k.l}</div>
        <div style={{fontSize:26,fontWeight:800,color:k.c,lineHeight:1}}>{k.v}</div>
      </div>)}
    </div>

    {/* Search + filter */}
    <div style={{display:"flex",gap:8,marginBottom:16,alignItems:"center"}}>
      <input value={searchQ} onChange={e=>setSearchQ(e.target.value)} placeholder="Search building address…" style={{flex:1,maxWidth:300,padding:"7px 12px",border:"1px solid var(--bd)",borderRadius:9,fontSize:12,color:"var(--t1)",outline:"none",background:"var(--white)"}}/>
      <button onClick={()=>setFilterMissing(s=>!s)} style={{padding:"7px 14px",borderRadius:9,border:`1px solid ${filterMissing?"var(--red)":"var(--bd)"}`,background:filterMissing?"var(--rbg)":"var(--white)",color:filterMissing?"var(--red)":"var(--t3)",fontSize:11,fontWeight:filterMissing?700:400,cursor:"pointer"}}>
        {filterMissing?"Showing: Missing Docs":"Filter: Missing Required"}
      </button>
      <span style={{fontSize:11,color:"var(--t4)"}}>{filteredLoans.length} building{filteredLoans.length!==1?"s":""}</span>
    </div>

    {/* Building grid */}
    <div style={{display:"flex",flexDirection:"column",gap:8}}>
      {filteredLoans.map(l=>{
        const ld=docs[l.id]||{};
        const reqSlots=DOC_SLOTS.filter(s=>s.required);
        const filledReq=reqSlots.filter(s=>(ld[s.id]||[]).length>0).length;
        const allFilled=filledReq===reqSlots.length;
        const totalFilesForLoan=Object.values(ld).reduce((s,a)=>s+a.length,0);
        const isExpanded=expandedLoan===l.id;
        const el=enrich(l);

        return(<div key={l.id} style={{background:"var(--white)",border:`1px solid ${allFilled?"var(--gbd)":"var(--bd)"}`,borderRadius:14,overflow:"hidden",transition:"box-shadow .15s"}}>
          {/* Building header row */}
          <div onClick={()=>setExpandedLoan(isExpanded?null:l.id)} style={{padding:"14px 20px",cursor:"pointer",display:"flex",alignItems:"center",gap:16,userSelect:"none"}}>
            {/* Doc coverage mini-bar */}
            <div style={{width:48,height:48,borderRadius:12,background:allFilled?"var(--gbg)":"var(--rbg)",border:`1px solid ${allFilled?"var(--gbd)":"var(--rbd)"}`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
              <div style={{textAlign:"center"}}>
                <div style={{fontSize:14,fontWeight:800,color:allFilled?"var(--green)":"var(--red)"}}>{filledReq}</div>
                <div style={{fontSize:8,color:allFilled?"var(--green)":"var(--red)",lineHeight:1}}>/{reqSlots.length}</div>
              </div>
            </div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:13,fontWeight:700,color:"var(--t1)",marginBottom:2}}>{l.addr}</div>
              <div style={{fontSize:10,color:"var(--t3)"}}>{l.lender} · {fPct(l.rate)} · Matures {fDateS(l.maturityDate)}</div>
              {/* Slot progress dots */}
              <div style={{display:"flex",gap:3,marginTop:6,flexWrap:"wrap"}}>
                {DOC_SLOTS.map(s=>{
                  const filled=(ld[s.id]||[]).length>0;
                  return(<div key={s.id} title={`${s.label}: ${filled?"uploaded":"missing"}`} style={{width:8,height:8,borderRadius:"50%",background:filled?"var(--green)":s.required?"var(--red)":"var(--bd2)",flexShrink:0}}/>);
                })}
                {totalFilesForLoan>0&&<span style={{fontSize:9,color:"var(--t4)",marginLeft:4}}>{totalFilesForLoan} file{totalFilesForLoan!==1?"s":""}</span>}
              </div>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:10,flexShrink:0}}>
              {allFilled&&<span style={{fontSize:9,fontWeight:800,padding:"3px 10px",borderRadius:20,background:"var(--gbg)",color:"var(--green)",border:"1px solid var(--gbd)"}}>✓ COMPLETE</span>}
              {!allFilled&&loansMissingRequired>0&&<span style={{fontSize:9,fontWeight:700,color:"var(--red)"}}>{reqSlots.length-filledReq} req. missing</span>}
              <span style={{fontSize:13,color:"var(--t4)",transform:isExpanded?"rotate(90deg)":"",transition:"transform .2s",display:"inline-block"}}>▶</span>
            </div>
          </div>

          {/* Expanded slot grid */}
          {isExpanded&&<div style={{borderTop:"1px solid var(--bd)",padding:"16px 20px",background:"var(--bg)"}}>
            <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:10}}>
              {DOC_SLOTS.map(slot=>{
                const files=ld[slot.id]||[];
                const slotKey=`${l.id}-${slot.id}`;
                const isUploading=uploadingSlot===slotKey;
                return(<div key={slot.id} style={{background:"var(--white)",border:`1px solid ${files.length>0?"var(--gbd)":slot.required?"var(--rbd)":"var(--bd)"}`,borderRadius:12,overflow:"hidden"}}>
                  {/* Slot header */}
                  <div style={{padding:"8px 10px",borderBottom:"1px solid var(--bd)",background:files.length>0?"var(--gbg)":slot.required?"var(--rbg)":"var(--bg)",display:"flex",alignItems:"center",gap:6}}>
                    <span style={{fontSize:14}}>{slot.icon}</span>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:9,fontWeight:700,color:files.length>0?"var(--green)":slot.required?"var(--red)":"var(--t3)",lineHeight:1.2}}>{slot.label}</div>
                      {slot.required&&<div style={{fontSize:8,color:"var(--t4)"}}>required</div>}
                    </div>
                    {files.length>0&&<span style={{fontSize:9,fontWeight:800,color:"var(--green)"}}>✓</span>}
                  </div>

                  {/* Files */}
                  <div style={{padding:"8px 10px",minHeight:60}}>
                    {files.length===0&&<div style={{fontSize:9,color:"var(--t4)",textAlign:"center",padding:"8px 0",opacity:.7}}>No files</div>}
                    {files.map(f=>(
                      <div key={f.id} style={{marginBottom:5}}>
                        {isImg(f.type)
                          ? <ImgSlot f={f} getUrl={getUrl} onLightbox={setLightbox}/>
                          : <div style={{display:"flex",alignItems:"center",gap:5,padding:"4px 6px",background:"var(--bg)",borderRadius:6}}>
                              <span style={{fontSize:12}}>📄</span>
                              <div style={{flex:1,minWidth:0}}>
                                <div style={{fontSize:9,fontWeight:600,color:"var(--t1)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{f.name}</div>
                                <div style={{fontSize:8,color:"var(--t4)"}}>{fmtSize(f.size)}</div>
                              </div>
                            </div>
                        }
                        <div style={{display:"flex",gap:3,marginTop:3}}>
                          <button onClick={()=>downloadFile(f)} style={{flex:1,padding:"2px 0",background:"var(--bbg)",border:"1px solid var(--bbd)",borderRadius:5,fontSize:8,color:"var(--blue)",cursor:"pointer",fontWeight:600}}>⬇</button>
                          <button onClick={()=>deleteFile(l.id,slot.id,f.id)} style={{flex:1,padding:"2px 0",background:"var(--rbg)",border:"1px solid var(--rbd)",borderRadius:5,fontSize:8,color:"var(--red)",cursor:"pointer"}}>✕</button>
                        </div>
                      </div>
                    ))}

                    {/* Upload button */}
                    <label style={{display:"block",marginTop:4,padding:"5px",background:isUploading?"var(--bg)":"transparent",border:`1px dashed ${isUploading?"var(--t4)":"var(--bd2)"}`,borderRadius:7,textAlign:"center",cursor:isUploading?"default":"pointer",transition:"border-color .15s"}}
                      onMouseEnter={e=>{if(!isUploading)e.currentTarget.style.borderColor="var(--blue)";}}
                      onMouseLeave={e=>{e.currentTarget.style.borderColor="var(--bd2)";}}>
                      <input type="file" style={{display:"none"}} accept="image/*,.pdf,.doc,.docx,.xls,.xlsx" disabled={isUploading}
                        onChange={e=>{const f=e.target.files?.[0];if(f)uploadFile(l.id,slot.id,f);e.target.value="";}}/>
                      <span style={{fontSize:9,color:"var(--t4)"}}>{isUploading?"⏳…":"＋ Upload"}</span>
                    </label>
                  </div>
                </div>);
              })}
            </div>
          </div>}
        </div>);
      })}
    </div>

    {/* Lightbox */}
    {lightbox&&<div onClick={()=>setLightbox(null)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,.85)",zIndex:2000,display:"flex",alignItems:"center",justifyContent:"center",padding:24,cursor:"pointer"}}>
      <div style={{maxWidth:"90vw",maxHeight:"85vh",display:"flex",flexDirection:"column",gap:8}}>
        <img src={lightbox.src} alt={lightbox.name} style={{maxWidth:"100%",maxHeight:"78vh",borderRadius:12,objectFit:"contain"}}/>
        <div style={{textAlign:"center",fontSize:12,color:"rgba(255,255,255,.6)"}}>{lightbox.name} — click anywhere to close</div>
      </div>
    </div>}
  </div>);
}

/* ─────────── STATEMENT ANALYZER ─────────── */
function StatementAnalyzer({loans}){
  const [file,setFile]=useState(null);
  const [fileData,setFileData]=useState(null);
  const [fileType,setFileType]=useState(null);
  const [analyzing,setAnalyzing]=useState(false);
  const [result,setResult]=useState(null);
  const [selLoan,setSelLoan]=useState(String(loans[0]?.id||""));
  const [dragOver,setDragOver]=useState(false);
  const fileRef=React.useRef(null);

  const handleFile=async f=>{
    if(!f)return;
    const allowed=["application/pdf","image/jpeg","image/png","image/jpg"];
    if(!allowed.includes(f.type)&&!f.name.endsWith(".pdf")){alert("Upload a PDF or image of your financial statement.");return;}
    if(f.size>4.5*1024*1024){alert("File must be under 4.5MB.");return;}
    setFile(f);setResult(null);
    const b64=await new Promise((res,rej)=>{const r=new FileReader();r.onload=e=>res(e.target.result.split(",")[1]);r.onerror=rej;r.readAsDataURL(f);});
    setFileData(b64);setFileType(f.type.includes("pdf")?"application/pdf":f.type);
  };

  const analyze=async()=>{
    if(!fileData)return;
    setAnalyzing(true);setResult(null);
    const loan=loans.find(l=>String(l.id)===selLoan);
    const el=loan?enrich(loan):null;

    const systemPrompt=`You are a senior CRE mortgage analyst specializing in refinancing risk assessment for Brooklyn multifamily portfolios. Analyze the uploaded financial statement and provide a structured refi risk report.

${loan?`Loan context for ${loan.addr}:
- Lender: ${loan.lender} | Type: ${loan.loanType} | Rate: ${fPct(loan.rate)}
- Current balance: ${f$(el?.curBal)} | Original: ${f$(loan.origBalance)}
- Maturity: ${loan.maturityDate} (${el?.daysLeft>0?el?.daysLeft+" days":Math.abs(el?.daysLeft||0)+" days overdue"})
- DSCR Covenant: ${loan.dscrCovenant||"N/A"} | Current NOI: ${loan.annualNOI?f$(loan.annualNOI):"Not on file"}
- Prepay: ${loan.prepay||"None"}`:""} 

Return a JSON object with exactly this structure:
{
  "refiRiskScore": 1-10 (1=easy refi, 10=near impossible),
  "riskRating": "Low"|"Moderate"|"High"|"Critical",
  "incomeAnalysis": {
    "effectiveGrossIncome": "$X",
    "operatingExpenses": "$X",
    "noi": "$X",
    "noiTrend": "Increasing"|"Stable"|"Declining"|"Cannot determine",
    "vacancyRate": "X%" or "Not stated",
    "notes": "brief analysis"
  },
  "debtServiceCoverage": {
    "currentDSCR": "X.XXx" or "Cannot calculate",
    "requiredDSCR": "typically 1.20-1.25x for most lenders",
    "meetsThreshold": true|false|null,
    "notes": "brief notes"
  },
  "keyRisks": ["risk 1","risk 2","risk 3"],
  "refiReadiness": {
    "incomeStrength": "Strong"|"Adequate"|"Weak"|"Unknown",
    "documentationQuality": "Complete"|"Partial"|"Insufficient",
    "estimatedLTV": "X%" or "Cannot calculate",
    "maxPotentialLoan": "$X" or "Cannot calculate"
  },
  "recommendations": ["action 1","action 2","action 3"],
  "redFlags": ["flag 1"] or [],
  "positives": ["positive 1"] or [],
  "summary": "2-3 sentence executive summary of refi prospects"
}

Respond with ONLY the JSON object. No markdown, no explanation.`;

    try{
      const contentBlocks=[
        {type:fileType==="application/pdf"?"document":"image",source:{type:"base64",media_type:fileType,data:fileData}},
        {type:"text",text:"Analyze this financial statement and return the JSON refi risk assessment."}
      ];
      const resp=await fetch("https://api.anthropic.com/v1/messages",{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:1000,system:systemPrompt,messages:[{role:"user",content:contentBlocks}]})
      });
      const data=await resp.json();
      const raw=data.content?.filter(b=>b.type==="text").map(b=>b.text).join("")||"{}";
      const clean=raw.replace(/```json|```/g,"").trim();
      setResult(JSON.parse(clean));
    }catch(e){setResult({error:true,message:`Analysis failed: ${e.message}. Please try again.`});}
    setAnalyzing(false);
  };

  const riskColor=r=>r==="Low"?"var(--green)":r==="Moderate"?"var(--amber)":r==="High"?"var(--red)":"var(--red)";
  const riskBg=r=>r==="Low"?"var(--gbg)":r==="Moderate"?"#fffbeb":r==="High"?"var(--rbg)":"var(--rbg)";

  return(<div>
    <div style={{marginBottom:20}}>
      <div style={{fontSize:22,fontWeight:700,color:"var(--t1)",marginBottom:4}}>Statement Analyzer</div>
      <div style={{fontSize:13,color:"var(--t3)"}}>Upload a rent roll, operating statement, or profit & loss — AI grades your refi readiness and surfaces risks.</div>
    </div>

    <div style={{display:"grid",gridTemplateColumns:"340px 1fr",gap:16,alignItems:"start"}}>
      {/* Left: upload panel */}
      <div style={{display:"flex",flexDirection:"column",gap:12}}>
        {/* Loan selector */}
        {loans.length>0&&<div style={{background:"var(--white)",border:"1px solid var(--bd)",borderRadius:14,padding:"14px 16px"}}>
          <div style={{fontSize:10,fontWeight:700,color:"var(--t3)",textTransform:"uppercase",letterSpacing:".07em",marginBottom:8}}>Link to Loan (Optional)</div>
          <select value={selLoan} onChange={e=>setSelLoan(e.target.value)} className="finp" style={{width:"100%"}}>
            <option value="">No loan selected</option>
            {loans.map(l=><option key={l.id} value={String(l.id)}>{l.addr} — {l.lender}</option>)}
          </select>
        </div>}

        {/* Drop zone */}
        <div
          onDragOver={e=>{e.preventDefault();setDragOver(true);}}
          onDragLeave={()=>setDragOver(false)}
          onDrop={e=>{e.preventDefault();setDragOver(false);handleFile(e.dataTransfer.files[0]);}}
          onClick={()=>fileRef.current?.click()}
          style={{border:`2px dashed ${dragOver?"var(--blue)":file?"var(--green)":"var(--bd2)"}`,borderRadius:14,padding:"28px 20px",textAlign:"center",cursor:"pointer",background:dragOver?"var(--bbg)":file?"var(--gbg)":"var(--white)",transition:"all .15s"}}>
          <input ref={fileRef} type="file" accept=".pdf,image/*" style={{display:"none"}} onChange={e=>handleFile(e.target.files?.[0])}/>
          <div style={{fontSize:28,marginBottom:8,opacity:.5}}>{file?"✅":"📤"}</div>
          <div style={{fontSize:13,fontWeight:700,color:"var(--t1)",marginBottom:4}}>
            {file?file.name:"Drop statement here"}
          </div>
          <div style={{fontSize:11,color:"var(--t3)"}}>
            {file?`${(file.size/1024).toFixed(0)}KB · Click to change`:"PDF or image · Rent roll, P&L, operating statement · up to 4.5MB"}
          </div>
        </div>

        {file&&<button onClick={analyze} disabled={analyzing} style={{width:"100%",padding:"12px",background:analyzing?"var(--bd2)":"var(--t1)",border:"none",borderRadius:12,color:"#fff",fontSize:13,fontWeight:800,cursor:analyzing?"default":"pointer",transition:"all .15s",letterSpacing:".02em"}}>
          {analyzing?"🧠 Analyzing…":"Analyze Refi Risk →"}
        </button>}

        {analyzing&&<div style={{background:"var(--white)",border:"1px solid var(--bd)",borderRadius:12,padding:"14px 16px",textAlign:"center"}}>
          <div style={{fontSize:11,color:"var(--t3)",marginBottom:6}}>Reading document…</div>
          <div style={{display:"flex",gap:4,justifyContent:"center"}}>
            {[0,1,2,3].map(i=><div key={i} style={{width:8,height:8,borderRadius:"50%",background:"var(--blue)",animation:`pulse 1.4s ease-in-out ${i*0.15}s infinite`}}/>)}
          </div>
        </div>}

        {/* Tips */}
        <div style={{background:"var(--bbg)",border:"1px solid var(--bbd)",borderRadius:12,padding:"13px 16px"}}>
          <div style={{fontSize:10,fontWeight:700,color:"var(--blue)",marginBottom:6}}>💡 Best documents to upload</div>
          {["Current year rent roll with occupancy","Last 2 years operating statements","T12 income & expense statement","Year-to-date P&L with actuals"].map((t,i)=>(
            <div key={i} style={{fontSize:10,color:"var(--t3)",marginBottom:3,display:"flex",gap:6}}><span style={{color:"var(--blue)"}}>→</span>{t}</div>
          ))}
        </div>
      </div>

      {/* Right: results */}
      <div>
        {!result&&!analyzing&&<div style={{background:"var(--white)",border:"2px dashed var(--bd2)",borderRadius:16,padding:"64px 32px",textAlign:"center"}}>
          <div style={{fontSize:40,opacity:.15,marginBottom:12}}>📊</div>
          <div style={{fontSize:15,fontWeight:700,color:"var(--t3)",marginBottom:6}}>Upload a statement to begin analysis</div>
          <div style={{fontSize:12,color:"var(--t4)"}}>AI will extract income, expenses, DSCR, and grade your refinancing readiness.</div>
        </div>}

        {result&&result.error&&<div style={{background:"var(--rbg)",border:"1px solid var(--rbd)",borderRadius:14,padding:"24px"}}>
          <div style={{fontSize:14,fontWeight:700,color:"var(--red)",marginBottom:6}}>Analysis Error</div>
          <div style={{fontSize:12,color:"var(--t2)"}}>{result.message}</div>
        </div>}

        {result&&!result.error&&<div style={{display:"flex",flexDirection:"column",gap:12}}>
          {/* Risk score hero */}
          <div style={{background:riskBg(result.riskRating),border:`1px solid ${riskColor(result.riskRating)}30`,borderRadius:16,padding:"20px 24px",display:"flex",alignItems:"center",gap:24}}>
            <div style={{textAlign:"center",flexShrink:0}}>
              <div style={{fontSize:48,fontWeight:900,color:riskColor(result.riskRating),lineHeight:1}}>{result.refiRiskScore}</div>
              <div style={{fontSize:9,fontWeight:700,color:riskColor(result.riskRating),textTransform:"uppercase",letterSpacing:".1em",marginTop:2}}>Risk Score /10</div>
            </div>
            <div style={{flex:1}}>
              <div style={{fontSize:20,fontWeight:800,color:riskColor(result.riskRating),marginBottom:6}}>{result.riskRating} Risk</div>
              <div style={{fontSize:12,color:"var(--t2)",lineHeight:1.7}}>{result.summary}</div>
            </div>
          </div>

          {/* Income + DSCR */}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
            <div style={{background:"var(--white)",border:"1px solid var(--bd)",borderRadius:14,padding:"16px 18px"}}>
              <div style={{fontSize:10,fontWeight:800,color:"var(--t3)",textTransform:"uppercase",letterSpacing:".08em",marginBottom:12}}>Income Analysis</div>
              {[
                {l:"Eff. Gross Income",v:result.incomeAnalysis?.effectiveGrossIncome},
                {l:"Operating Expenses",v:result.incomeAnalysis?.operatingExpenses},
                {l:"Net Operating Income",v:result.incomeAnalysis?.noi,bold:true},
                {l:"Vacancy Rate",v:result.incomeAnalysis?.vacancyRate},
                {l:"NOI Trend",v:result.incomeAnalysis?.noiTrend},
              ].map((r,i)=><div key={i} style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:"1px solid var(--bd)",fontSize:11}}>
                <span style={{color:"var(--t3)"}}>{r.l}</span>
                <span style={{fontWeight:r.bold?800:600,color:"var(--t1)"}}>{r.v||"—"}</span>
              </div>)}
              {result.incomeAnalysis?.notes&&<div style={{fontSize:10,color:"var(--t4)",marginTop:8,lineHeight:1.5}}>{result.incomeAnalysis.notes}</div>}
            </div>
            <div style={{background:"var(--white)",border:"1px solid var(--bd)",borderRadius:14,padding:"16px 18px"}}>
              <div style={{fontSize:10,fontWeight:800,color:"var(--t3)",textTransform:"uppercase",letterSpacing:".08em",marginBottom:12}}>Debt Service Coverage</div>
              {[
                {l:"Calculated DSCR",v:result.debtServiceCoverage?.currentDSCR,bold:true},
                {l:"Lender Minimum",v:result.debtServiceCoverage?.requiredDSCR},
                {l:"Meets Threshold",v:result.debtServiceCoverage?.meetsThreshold===true?"✅ Yes":result.debtServiceCoverage?.meetsThreshold===false?"❌ No":"Unknown"},
              ].map((r,i)=><div key={i} style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:"1px solid var(--bd)",fontSize:11}}>
                <span style={{color:"var(--t3)"}}>{r.l}</span>
                <span style={{fontWeight:r.bold?800:600,color:"var(--t1)"}}>{r.v||"—"}</span>
              </div>)}
              <div style={{fontSize:10,fontWeight:800,color:"var(--t3)",textTransform:"uppercase",letterSpacing:".08em",marginBottom:8,marginTop:12}}>Refi Readiness</div>
              {[
                {l:"Income Strength",v:result.refiReadiness?.incomeStrength},
                {l:"Documentation",v:result.refiReadiness?.documentationQuality},
                {l:"Est. LTV",v:result.refiReadiness?.estimatedLTV},
                {l:"Max Loan",v:result.refiReadiness?.maxPotentialLoan},
              ].map((r,i)=><div key={i} style={{display:"flex",justifyContent:"space-between",padding:"5px 0",borderBottom:"1px solid var(--bd)",fontSize:11}}>
                <span style={{color:"var(--t3)"}}>{r.l}</span>
                <span style={{fontWeight:600,color:"var(--t1)"}}>{r.v||"—"}</span>
              </div>)}
              {result.debtServiceCoverage?.notes&&<div style={{fontSize:10,color:"var(--t4)",marginTop:8,lineHeight:1.5}}>{result.debtServiceCoverage.notes}</div>}
            </div>
          </div>

          {/* Flags, Risks, Recommendations */}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12}}>
            {result.redFlags?.length>0&&<div style={{background:"var(--rbg)",border:"1px solid var(--rbd)",borderRadius:12,padding:"14px 16px"}}>
              <div style={{fontSize:10,fontWeight:800,color:"var(--red)",textTransform:"uppercase",letterSpacing:".07em",marginBottom:8}}>🚩 Red Flags</div>
              {result.redFlags.map((f,i)=><div key={i} style={{fontSize:11,color:"var(--t2)",marginBottom:5,display:"flex",gap:6}}><span style={{color:"var(--red)",flexShrink:0}}>•</span>{f}</div>)}
            </div>}
            {result.keyRisks?.length>0&&<div style={{background:"#fffbeb",border:"1px solid var(--abd)",borderRadius:12,padding:"14px 16px"}}>
              <div style={{fontSize:10,fontWeight:800,color:"var(--amber)",textTransform:"uppercase",letterSpacing:".07em",marginBottom:8}}>⚠️ Key Risks</div>
              {result.keyRisks.map((r,i)=><div key={i} style={{fontSize:11,color:"var(--t2)",marginBottom:5,display:"flex",gap:6}}><span style={{color:"var(--amber)",flexShrink:0}}>•</span>{r}</div>)}
            </div>}
            {result.positives?.length>0&&<div style={{background:"var(--gbg)",border:"1px solid var(--gbd)",borderRadius:12,padding:"14px 16px"}}>
              <div style={{fontSize:10,fontWeight:800,color:"var(--green)",textTransform:"uppercase",letterSpacing:".07em",marginBottom:8}}>✅ Positives</div>
              {result.positives.map((p,i)=><div key={i} style={{fontSize:11,color:"var(--t2)",marginBottom:5,display:"flex",gap:6}}><span style={{color:"var(--green)",flexShrink:0}}>•</span>{p}</div>)}
            </div>}
          </div>

          {result.recommendations?.length>0&&<div style={{background:"var(--white)",border:"1px solid var(--bd)",borderRadius:12,padding:"14px 18px"}}>
            <div style={{fontSize:10,fontWeight:800,color:"var(--t3)",textTransform:"uppercase",letterSpacing:".07em",marginBottom:10}}>📋 Recommended Next Steps</div>
            <div style={{display:"flex",flexDirection:"column",gap:6}}>
              {result.recommendations.map((r,i)=><div key={i} style={{fontSize:12,color:"var(--t2)",display:"flex",gap:10,alignItems:"flex-start"}}>
                <span style={{width:20,height:20,borderRadius:"50%",background:"var(--t1)",color:"#fff",fontSize:9,fontWeight:800,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,marginTop:1}}>{i+1}</span>
                {r}
              </div>)}
            </div>
          </div>}
        </div>}
      </div>
    </div>
    <style>{`@keyframes pulse{0%,60%,100%{opacity:.2}30%{opacity:1}}`}</style>
  </div>);
}

/* ─────────── MARKET DATA ─────────── */
function MarketDataView(){
  const [data,setData]=useState(null);
  const [loading,setLoading]=useState(false);
  const [lastFetched,setLastFetched]=useState(null);
  const [error,setError]=useState(null);

  const fetch_=async()=>{
    setLoading(true);setError(null);
    const prompt=`You are a CRE finance data analyst. Search for and return the latest market data relevant to commercial real estate lending, specifically for multifamily properties in New York. Return a JSON object with this exact structure:

{
  "fetchedAt": "ISO date string",
  "rates": {
    "sofr_30day": {"value": "X.XX%", "change": "+/-X.XX% vs last week", "note": "brief context"},
    "treasury_10yr": {"value": "X.XX%", "change": "+/-X.XX%", "note": "brief context"},
    "treasury_5yr": {"value": "X.XX%", "change": "+/-X.XX%", "note": "brief context"},
    "prime_rate": {"value": "X.XX%", "change": "+/-X.XX%", "note": "brief context"},
    "fed_funds": {"value": "X.XX-X.XX%", "change": "context", "note": "brief context"}
  },
  "cre_lending": {
    "multifamily_agency": {"rate": "X.XX-X.XX%", "spread": "X.XXx over 10yr", "note": "Fannie/Freddie current indicative rates"},
    "multifamily_bank": {"rate": "X.XX-X.XX%", "spread": "over SOFR/Treasury", "note": "regional/community bank market"},
    "bridge": {"rate": "X.XX-X.XX%", "spread": "over SOFR", "note": "bridge/transitional market"},
    "cmbs": {"rate": "X.XX-X.XX%", "note": "conduit/CMBS current market"},
    "debt_fund": {"rate": "X.XX-X.XX%", "note": "debt fund/private credit"}
  },
  "nyc_multifamily": {
    "cap_rates": {"brooklyn": "X.X-X.X%", "queens": "X.X-X.X%", "bronx": "X.X-X.X%", "manhattan": "X.X-X.X%"},
    "vacancy": "X.X% metro area",
    "rent_growth_yoy": "+/-X.X%",
    "market_sentiment": "description of current lending environment"
  },
  "lending_environment": {
    "lender_appetite": "Strong|Moderate|Cautious|Tight",
    "ltv_range": "X-X%",
    "dscr_requirements": "typically X.XX-X.XXx",
    "key_themes": ["theme 1", "theme 2", "theme 3"],
    "headwinds": ["headwind 1", "headwind 2"],
    "tailwinds": ["tailwind 1", "tailwind 2"]
  },
  "analyst_take": "2-3 sentence current market summary for a Brooklyn multifamily owner deciding whether to refinance now or wait"
}

Use web search to get the most current data available. Return ONLY the JSON object.`;

    try{
      const resp=await fetch("https://api.anthropic.com/v1/messages",{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          model:"claude-sonnet-4-20250514",max_tokens:1000,
          tools:[{type:"web_search_20250305",name:"web_search"}],
          messages:[{role:"user",content:prompt}]
        })
      });
      const res=await resp.json();
      const textBlocks=res.content?.filter(b=>b.type==="text")||[];
      const raw=textBlocks.map(b=>b.text).join("");
      const clean=raw.replace(/```json|```/g,"").trim();
      const parsed=JSON.parse(clean);
      parsed.fetchedAt=parsed.fetchedAt||new Date().toISOString();
      setData(parsed);
      setLastFetched(new Date());
    }catch(e){setError(`Failed to fetch market data: ${e.message}`);}
    setLoading(false);
  };

  const appetiteColor=a=>a==="Strong"?"var(--green)":a==="Moderate"?"var(--blue)":a==="Cautious"?"var(--amber)":"var(--red)";

  return(<div>
    <div style={{marginBottom:20,display:"flex",justifyContent:"space-between",alignItems:"flex-end"}}>
      <div>
        <div style={{fontSize:22,fontWeight:700,color:"var(--t1)",marginBottom:4}}>Current Markets</div>
        <div style={{fontSize:13,color:"var(--t3)"}}>Live CRE lending rates, NYC multifamily cap rates, and market conditions — pulled fresh from the web.</div>
      </div>
      <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:6}}>
        {lastFetched&&<div style={{fontSize:10,color:"var(--t4)"}}>Last updated {lastFetched.toLocaleTimeString()}</div>}
        <button onClick={fetch_} disabled={loading} className="btn-dark" style={{fontSize:12}}>
          {loading?"⏳ Fetching…":"⚡ Fetch Live Data"}
        </button>
      </div>
    </div>

    {error&&<div style={{background:"var(--rbg)",border:"1px solid var(--rbd)",borderRadius:12,padding:"14px 16px",marginBottom:16,fontSize:12,color:"var(--red)"}}>{error}</div>}

    {!data&&!loading&&<div style={{background:"var(--white)",border:"2px dashed var(--bd2)",borderRadius:16,padding:"64px 32px",textAlign:"center"}}>
      <div style={{fontSize:40,opacity:.15,marginBottom:12}}>📈</div>
      <div style={{fontSize:15,fontWeight:700,color:"var(--t3)",marginBottom:8}}>No market data loaded</div>
      <div style={{fontSize:12,color:"var(--t4)",marginBottom:20}}>Click "Fetch Live Data" to pull current rates, SOFR, Treasury yields, NYC cap rates, and lender appetite from live sources.</div>
      <button onClick={fetch_} className="btn-dark" style={{fontSize:13}}>⚡ Fetch Live Market Data</button>
    </div>}

    {loading&&<div style={{display:"flex",flexDirection:"column",gap:12}}>
      {[...Array(4)].map((_,i)=><div key={i} style={{height:80,background:"var(--white)",border:"1px solid var(--bd)",borderRadius:14,animation:"shimmer 1.5s infinite",opacity:.6}}/>)}
      <div style={{textAlign:"center",fontSize:12,color:"var(--t3)",marginTop:8}}>Searching live market data sources…</div>
    </div>}

    {data&&!loading&&<div style={{display:"flex",flexDirection:"column",gap:16}}>

      {/* Analyst take */}
      {data.analyst_take&&<div style={{background:"linear-gradient(135deg,#0f172a,#1e293b)",border:"1px solid rgba(255,255,255,.08)",borderRadius:16,padding:"20px 24px"}}>
        <div style={{fontSize:9,fontWeight:800,color:"rgba(212,175,55,.7)",textTransform:"uppercase",letterSpacing:".12em",marginBottom:8}}>ANALYST TAKE — {new Date(data.fetchedAt).toLocaleDateString("en-US",{month:"long",day:"numeric",year:"numeric"})}</div>
        <div style={{fontSize:14,color:"#e2e8f0",lineHeight:1.8,fontStyle:"italic"}}>"{data.analyst_take}"</div>
      </div>}

      {/* Benchmark Rates */}
      <div>
        <div style={{fontSize:12,fontWeight:800,color:"var(--t2)",marginBottom:10,textTransform:"uppercase",letterSpacing:".07em"}}>📊 Benchmark Rates</div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:8}}>
          {data.rates&&Object.entries(data.rates).map(([key,r])=>{
            const labels={sofr_30day:"SOFR 30-Day",treasury_10yr:"10-Year UST",treasury_5yr:"5-Year UST",prime_rate:"Prime Rate",fed_funds:"Fed Funds"};
            const up=r.change?.includes("+");const down=r.change?.includes("-");
            return(<div key={key} style={{background:"var(--white)",border:"1px solid var(--bd)",borderRadius:12,padding:"14px 14px"}}>
              <div style={{fontSize:9,fontWeight:700,color:"var(--t4)",textTransform:"uppercase",letterSpacing:".06em",marginBottom:6}}>{labels[key]||key.replace(/_/g," ")}</div>
              <div style={{fontSize:22,fontWeight:900,color:"var(--t1)",lineHeight:1,marginBottom:4}}>{r.value}</div>
              <div style={{fontSize:10,fontWeight:600,color:up?"var(--red)":down?"var(--green)":"var(--t4)"}}>{r.change}</div>
              {r.note&&<div style={{fontSize:9,color:"var(--t4)",marginTop:5,lineHeight:1.4}}>{r.note}</div>}
            </div>);
          })}
        </div>
      </div>

      {/* CRE Lending Rates */}
      <div>
        <div style={{fontSize:12,fontWeight:800,color:"var(--t2)",marginBottom:10,textTransform:"uppercase",letterSpacing:".07em"}}>🏦 CRE Lending Market</div>
        <div style={{background:"var(--white)",border:"1px solid var(--bd)",borderRadius:14,overflow:"hidden"}}>
          <table style={{width:"100%",borderCollapse:"collapse"}}>
            <thead><tr style={{background:"var(--bg)"}}>
              {["Loan Type","Rate Range","Spread","Notes"].map(h=><th key={h} style={{padding:"10px 16px",textAlign:"left",fontSize:9,fontWeight:700,color:"var(--t3)",textTransform:"uppercase",letterSpacing:".07em",borderBottom:"1px solid var(--bd)"}}>{h}</th>)}
            </tr></thead>
            <tbody>
              {data.cre_lending&&Object.entries(data.cre_lending).map(([key,r],i)=>{
                const labels={multifamily_agency:"Multifamily Agency (F/F)",multifamily_bank:"Multifamily Bank/CU",bridge:"Bridge / Transitional",cmbs:"CMBS / Conduit",debt_fund:"Debt Fund / Private"};
                return(<tr key={key} style={{borderBottom:"1px solid var(--bd)",background:i%2===0?"transparent":"var(--bg)"}}>
                  <td style={{padding:"12px 16px",fontSize:12,fontWeight:700,color:"var(--t1)"}}>{labels[key]||key}</td>
                  <td style={{padding:"12px 16px",fontSize:14,fontWeight:800,color:"var(--blue)",fontFamily:"monospace"}}>{r.rate||"—"}</td>
                  <td style={{padding:"12px 16px",fontSize:11,color:"var(--t3)"}}>{r.spread||"—"}</td>
                  <td style={{padding:"12px 16px",fontSize:11,color:"var(--t4)",maxWidth:200}}>{r.note||""}</td>
                </tr>);
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* NYC Multifamily + Lending Environment */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
        {/* NYC Cap Rates */}
        {data.nyc_multifamily&&<div style={{background:"var(--white)",border:"1px solid var(--bd)",borderRadius:14,padding:"16px 18px"}}>
          <div style={{fontSize:10,fontWeight:800,color:"var(--t3)",textTransform:"uppercase",letterSpacing:".07em",marginBottom:12}}>🗽 NYC Multifamily</div>
          <div style={{marginBottom:12}}>
            <div style={{fontSize:9,fontWeight:700,color:"var(--t4)",marginBottom:6}}>CAP RATES BY BOROUGH</div>
            {data.nyc_multifamily.cap_rates&&Object.entries(data.nyc_multifamily.cap_rates).map(([borough,rate])=>(
              <div key={borough} style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:"1px solid var(--bd)",fontSize:11}}>
                <span style={{color:"var(--t3)",textTransform:"capitalize"}}>{borough}</span>
                <span style={{fontWeight:700,color:"var(--t1)"}}>{rate}</span>
              </div>
            ))}
          </div>
          {[{l:"Metro Vacancy",v:data.nyc_multifamily.vacancy},{l:"Rent Growth YoY",v:data.nyc_multifamily.rent_growth_yoy}].map((r,i)=>(
            <div key={i} style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:"1px solid var(--bd)",fontSize:11}}>
              <span style={{color:"var(--t3)"}}>{r.l}</span><span style={{fontWeight:700,color:"var(--t1)"}}>{r.v||"—"}</span>
            </div>
          ))}
          {data.nyc_multifamily.market_sentiment&&<div style={{marginTop:10,fontSize:10,color:"var(--t3)",lineHeight:1.6,padding:"8px 10px",background:"var(--bg)",borderRadius:8}}>{data.nyc_multifamily.market_sentiment}</div>}
        </div>}

        {/* Lending Environment */}
        {data.lending_environment&&<div style={{background:"var(--white)",border:"1px solid var(--bd)",borderRadius:14,padding:"16px 18px"}}>
          <div style={{fontSize:10,fontWeight:800,color:"var(--t3)",textTransform:"uppercase",letterSpacing:".07em",marginBottom:12}}>🏛️ Lending Environment</div>
          <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:14,padding:"10px 12px",borderRadius:10,background:appetiteColor(data.lending_environment.lender_appetite)+"20",border:`1px solid ${appetiteColor(data.lending_environment.lender_appetite)}40`}}>
            <div style={{flex:1}}><div style={{fontSize:9,fontWeight:700,color:"var(--t4)",textTransform:"uppercase",letterSpacing:".07em",marginBottom:2}}>Lender Appetite</div>
            <div style={{fontSize:16,fontWeight:800,color:appetiteColor(data.lending_environment.lender_appetite)}}>{data.lending_environment.lender_appetite}</div></div>
          </div>
          {[{l:"LTV Range",v:data.lending_environment.ltv_range},{l:"DSCR Requirements",v:data.lending_environment.dscr_requirements}].map((r,i)=>(
            <div key={i} style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:"1px solid var(--bd)",fontSize:11}}>
              <span style={{color:"var(--t3)"}}>{r.l}</span><span style={{fontWeight:700,color:"var(--t1)"}}>{r.v||"—"}</span>
            </div>
          ))}
          {data.lending_environment.key_themes?.length>0&&<><div style={{fontSize:9,fontWeight:700,color:"var(--t4)",textTransform:"uppercase",letterSpacing:".07em",marginTop:10,marginBottom:6}}>Key Themes</div>
            {data.lending_environment.key_themes.map((t,i)=><div key={i} style={{fontSize:10,color:"var(--t2)",marginBottom:3,display:"flex",gap:6}}><span style={{color:"var(--blue)"}}>→</span>{t}</div>)}</>}
          {data.lending_environment.headwinds?.length>0&&<><div style={{fontSize:9,fontWeight:700,color:"var(--red)",textTransform:"uppercase",letterSpacing:".07em",marginTop:10,marginBottom:6}}>Headwinds</div>
            {data.lending_environment.headwinds.map((h,i)=><div key={i} style={{fontSize:10,color:"var(--t2)",marginBottom:2,display:"flex",gap:6}}><span style={{color:"var(--red)"}}>↓</span>{h}</div>)}</>}
          {data.lending_environment.tailwinds?.length>0&&<><div style={{fontSize:9,fontWeight:700,color:"var(--green)",textTransform:"uppercase",letterSpacing:".07em",marginTop:10,marginBottom:6}}>Tailwinds</div>
            {data.lending_environment.tailwinds.map((t,i)=><div key={i} style={{fontSize:10,color:"var(--t2)",marginBottom:2,display:"flex",gap:6}}><span style={{color:"var(--green)"}}>↑</span>{t}</div>)}</>}
        </div>}
      </div>
    </div>}
    <style>{`@keyframes shimmer{0%,100%{opacity:.4}50%{opacity:.7}}`}</style>
  </div>);
}

export default function App(){
  const [loans,setLoans]=useState(LOANS_INIT);
  const [view,setView]=useState("overview");
  const [sbFilt,setSbFilt]=useState("all");
  const [detail,setDetail]=useState(null);
  const [adding,setAdding]=useState(false);
  const [editing,setEditing]=useState(null);
  const [sbSearch,setSbSearch]=useState("");
  const [loaded,setLoaded]=useState(false);
  const [navGroups,setNavGroups]=useState({risk:true,maturities:true,relationships:true,intelligence:true});
  const [user,setUser]=useState(null);

  // Get current user
  useEffect(()=>{
    if(!supabase)return;
    supabase.auth.getUser().then(({data:{user}})=>setUser(user));
    const {data:{subscription}}=supabase.auth.onAuthStateChange((_,s)=>setUser(s?.user||null));
    return()=>subscription.unsubscribe();
  },[]);

  const signOut=async()=>{
    if(supabase)await supabase.auth.signOut();
  };

  // ── helpers: map DB row → app loan object ──────────────────────────────────
  const dbRowToLoan = r => ({
    id:               r.id,
    addr:             r.addr||"",
    lender:           r.lender||"",
    entity:           r.entity||"",
    origBalance:      Number(r.orig_balance)||0,       // Original Loan from Excel
    currentBalance:   Number(r.current_balance)||Number(r.orig_balance)||0, // Current Balance from Excel
    origDate:         r.close_date||"",
    rate:             Number(r.rate)||0,                // Full decimal e.g. 6.669
    termMonths:       r.term_months!=null ? Number(r.term_months) : null,
    termYears:        r.term_months!=null ? Number(r.term_months)/12 : null,
    amortYears:       30,
    maturityDate:     r.maturity_date||"",
    ppp:              r.ppp||"",
    prepay:           r.ppp||"",
    ioPeriodMonths:   r.io_period_months!=null ? Number(r.io_period_months) : null,
    interestOnly:     r.io_period_months!=null && r.io_period_months > 0,
    loanType:         (r.io_period_months!=null && r.io_period_months > 0) ? "IO" : "Fixed",
    recourse:         false,
    dscrCovenant:     null,
    annualNOI:        null,
    refiStatus:       r.refi_status||"Not Started",
    notes:            r.notes||"",
    activityLog:      r.activity_log||[]
  });
  const loanToDbRow = l => ({
    addr:             l.addr,
    lender:           l.lender,
    entity:           l.entity||"",
    orig_balance:     l.origBalance||0,
    current_balance:  l.currentBalance||l.origBalance||0,
    close_date:       l.origDate||null,
    rate:             l.rate||0,
    term_months:      l.termMonths||(l.termYears?Math.round(l.termYears*12):null),
    maturity_date:    l.maturityDate||null,
    ppp:              l.ppp||l.prepay||"",
    io_period_months: l.ioPeriodMonths||(l.interestOnly&&l.termMonths?l.termMonths:null),
    refi_status:      l.refiStatus||"Not Started",
    notes:            l.notes||"",
    activity_log:     l.activityLog||[]
  });

  const [dbStatus,setDbStatus]=useState("loading");
  const [dbError,setDbError]=useState("");

  // ── load loans from DB ─────────────────────────────────────────────────────
  useEffect(()=>{(async()=>{
    try{
      if(supabase){
        const {data:{user},error:authErr}=await supabase.auth.getUser();
        if(authErr||!user){setDbStatus("error");setDbError("Not authenticated");setLoaded(true);return;}
        const {data,error}=await supabase.from("loans").select("*").order("id");
        if(error){
          setDbStatus("error");
          setDbError(error.message);
          console.error("loans load error:",error);
        } else if(data && data.length>0){
          setLoans(data.map(dbRowToLoan));
          setDbStatus("connected");
        } else {
          setDbStatus("empty");
        }
      } else {
        const r=await supaStorage.get("meridian-v5");
        if(r?.value){const p=JSON.parse(r.value);if(Array.isArray(p)&&p.length>0){setLoans(p);setDbStatus("connected");}}
        else setDbStatus("empty");
      }
    }catch(e){setDbStatus("error");setDbError(e.message);console.error("load loans:",e);}
    setLoaded(true);
  })();},[]);

  // ── CRUD — each operation hits the DB directly ─────────────────────────────
  const addLoan=async l=>{
    if(supabase){
      try{
        const {data:{user}}=await supabase.auth.getUser();
        const {data,error}=await supabase.from("loans").insert({...loanToDbRow(l),user_id:user.id}).select().single();
        if(!error&&data) setLoans(p=>[...p,dbRowToLoan(data)]);
      }catch(e){console.error("addLoan:",e); setLoans(p=>[...p,l]);}
    } else { setLoans(p=>[...p,l]); }
  };

  const saveLoan=async(id,ch)=>{
    setLoans(p=>p.map(l=>{
      if(l.id!==id)return l;
      if(ch.actAdd)return{...l,activityLog:[...(l.activityLog||[]),ch.actAdd]};
      if(ch.actDel)return{...l,activityLog:(l.activityLog||[]).filter(e=>e.id!==ch.actDel)};
      return{...l,...ch};
    }));
    if(supabase){
      try{
        const updated=await new Promise(res=>setLoans(p=>{const l=p.find(x=>x.id===id);res(l);return p;}));
        const loan=ch.actAdd||ch.actDel
          ? (() => { let l=null; setLoans(p=>{l=p.find(x=>x.id===id);return p;}); return l; })()
          : null;
        // re-read from state after update
        setTimeout(async()=>{
          setLoans(p=>{
            const l=p.find(x=>x.id===id);
            if(l&&supabase) supabase.from("loans").update(loanToDbRow(l)).eq("id",id).then(()=>{});
            return p;
          });
        },100);
      }catch(e){console.error("saveLoan:",e);}
    }
  };

  const deleteLoan=async id=>{
    setLoans(p=>p.filter(l=>l.id!==id));
    setDetail(null);
    if(supabase){
      try{ await supabase.from("loans").delete().eq("id",id); }
      catch(e){console.error("deleteLoan:",e);}
    }
  };

  // CSV export for entire portfolio
  const exportPortfolioCSV=()=>{
    const en=loans.map(enrich);
    downloadCSV("meridian-portfolio.csv",
      ["Address","Entity","Lender","Type","Orig Balance","Cur Balance","Rate","Monthly Pmt","Annual DS","Maturity","Days Left","Status","Refi Status","Prepay","NOI","DSCR","Recourse"],
      en.map(l=>[l.addr,l.entity||"",l.lender,l.loanType,l.origBalance,l.curBal.toFixed(0),l.rate,l.pmt.toFixed(0),l.annualDS.toFixed(0),l.maturityDate,l.daysLeft,l.status,l.refiStatus||"",l.prepay||"",l.annualNOI||"",l.dscr?l.dscr.toFixed(2):"",l.recourse?"Yes":"No"])
    );
  };

  const en=useMemo(()=>loans.map(enrich),[loans]);
  const counts={urgent:en.filter(l=>l.status==="urgent"||l.status==="matured").length,soon:en.filter(l=>l.status==="soon").length,ok:en.filter(l=>l.status==="ok").length};

  // Live alert count for nav badge (evaluate maturity + overdue rules inline)
  const liveAlertCount=useMemo(()=>{
    const maturityUrgent=en.filter(l=>l.daysLeft>=0&&l.daysLeft<=90).length;
    const overdue=en.filter(l=>l.daysLeft<0).length;
    return maturityUrgent+overdue;
  },[en]);
  const sbLoans=sbSearch?loans.filter(l=>l.addr.toLowerCase().includes(sbSearch.toLowerCase())||l.lender.toLowerCase().includes(sbSearch.toLowerCase())):loans;
  const openLoan=raw=>{setDetail(raw);setSbSearch("");};
  const detailRaw=detail?loans.find(l=>l.id===detail.id)||detail:null;
  const topbarTitle=detail?detailRaw.addr:view==="overview"?"Portfolio Overview":view==="loans"?"All Loans":view==="calc"?"Refi Calculator":view==="pipeline"?"Refinancing Pipeline":view==="cashflow"?"Cashflow Impact":view==="noidscr"?"NOI & DSCR Tracker":view==="covenant"?"Covenant Monitor":view==="ratecap"?"Rate Cap Tracker":view==="alerts"?"🔔 Alert System":view==="lendercrm"?"Lender Relationships":view==="contacts"?"Contacts":view==="propdocs"?"🗂️ Property Documents":view==="stmtanalyzer"?"📈 Statement Analyzer":view==="markets"?"📊 Current Markets":view==="docai"?"✨ Doc Abstractor AI":view==="timeline"?"Maturity Timeline":view==="schedule"?"Loan Maturity Schedule":"Lender Exposure";

  return(<AuthGate>
    <>
    <style>{CSS}</style>
    <style>{`
      /* Force full-page fill regardless of artifact/browser mount point */
      body,html{height:100%!important;width:100%!important;margin:0!important;padding:0!important;overflow:hidden!important;}
      body>div,body>div>div{height:100%!important;width:100%!important;}
    `}</style>
    <div className="shell">

      {/* ── SIDEBAR ── */}
      <div className="sb">
        <div className="sb-hd">
          <div className="sb-brand">
            <img src={LOGO} alt="Meridian Properties" style={{width:"100%",maxWidth:200,height:"auto",display:"block",margin:"0 auto 6px",filter:"brightness(1.05)"}}/>
            <div className="sb-firm-type" style={{textAlign:"center"}}>Brooklyn, New York</div>
            <div className="sb-firm-rule"/>
            <div className="sb-firm-meta">Debt Management · {new Date().getFullYear()}</div>
          </div>
        </div>
        <div style={{padding:"10px 14px 4px",borderBottom:"1px solid var(--sb-bd)"}}>
          <div className="sb-search">
            <span className="sb-si">🔍</span>
            <input placeholder="Search buildings…" value={sbSearch} onChange={e=>setSbSearch(e.target.value)}/>
          </div>
        </div>

        <div className="sb-nav">
          {/* Search results */}
          {sbSearch?(<>
            <div className="sb-sec">Results</div>
            {sbLoans.slice(0,8).map(l=>{const el=enrich(l);return(
              <div key={l.id} className="sb-row" onClick={()=>openLoan(l)}>
                <div className="sb-rl">
                  <div className="sb-rtxt">
                    <div className="sb-rlbl" style={{fontSize:11}}>{l.addr}</div>
                    <div className="sb-rsub">{fPct(l.rate)} · {fDateS(l.maturityDate)}</div>
                  </div>
                </div>
                <span className={`sb-badge ${el.status==="matured"||el.status==="urgent"?"bg-red":el.status==="soon"?"bg-amber":"bg-green"}`}>
                  {el.status==="matured"?"!":el.status==="urgent"?"⚡":el.status==="soon"?"~":"✓"}
                </span>
              </div>
            );})}
          </>):(<>

            {/* ── PINNED (no group header) ── */}
            {[
              {id:"overview",icon:"⊞",label:"Overview",sub:null},
              {id:"loans",icon:"📋",label:"All Loans",sub:`${loans.length} loan${loans.length!==1?"s":""}`},
            ].map(n=>(
              <div key={n.id} className={`sb-row${view===n.id&&!detail?" act":""}`} onClick={()=>{setView(n.id);setDetail(null);}}>
                <div className="sb-rl">
                  <span className="sb-ri">{n.icon}</span>
                  <div className="sb-rtxt">
                    <div className="sb-rlbl">{n.label}</div>
                    {n.sub&&<div className="sb-rsub">{n.sub}</div>}
                  </div>
                </div>
              </div>
            ))}

            <div className="sb-div" style={{margin:"8px 10px 6px"}}/>

            {/* ── GROUPED NAV ── */}
            {[
              {
                id:"risk", label:"Risk", icon:"⚠️",
                items:[
                  {id:"alerts",icon:"🔔",label:"Alert System",badge:liveAlertCount>0?liveAlertCount:null,bc:"bg-red"},
                  {id:"covenant",icon:"🛡️",label:"Covenant Monitor",badge:loans.filter(l=>l.dscrCovenant).length>0?loans.filter(l=>l.dscrCovenant).length:null,bc:"bg-grey"},
                  {id:"ratecap",icon:"📉",label:"Rate Cap",badge:loans.filter(l=>l.loanType==="ARM"||l.loanType==="SOFR").length||null,bc:"bg-grey"},
                  {id:"noidscr",icon:"📊",label:"NOI & DSCR Tracker",badge:null},
                ],
              },
              {
                id:"maturities", label:"Maturities & Exits", icon:"🗓",
                items:[
                  {id:"timeline",icon:"📅",label:"Timeline",badge:null},
                  {id:"schedule",icon:"🗓",label:"Schedule",badge:counts.urgent>0?counts.urgent:null,bc:"bg-red"},
                  {id:"calc",icon:"🧮",label:"Refi Calculator",badge:null},
                  {id:"pipeline",icon:"🔄",label:"Refi Pipeline",badge:null},
                  {id:"cashflow",icon:"💵",label:"Cashflow Impact",badge:null},
                ],
              },
              {
                id:"relationships", label:"Relationships", icon:"🤝",
                items:[
                  {id:"lendercrm",icon:"🤝",label:"Lender CRM",badge:null},
                  {id:"exposure",icon:"🏦",label:"Lender Exposure",badge:null},
                  {id:"contacts",icon:"👤",label:"Contacts",badge:null},
                  {id:"docai",icon:"✨",label:"Doc Abstractor AI",badge:null},
                ],
              },
              {
                id:"intelligence", label:"Intelligence", icon:"🧠",
                items:[
                  {id:"propdocs",icon:"🗂️",label:"Property Documents",badge:null},
                  {id:"stmtanalyzer",icon:"📈",label:"Statement Analyzer",badge:null},
                  {id:"markets",icon:"📊",label:"Current Markets",badge:null},
                ],
              },
            ].map(group=>{
              const isOpen=navGroups[group.id]!==false; // default open
              const hasActive=group.items.some(n=>n.id===view&&!detail);
              return(
                <div key={group.id} className="sb-group">
                  <div className="sb-group-hd" onClick={()=>setNavGroups(p=>({...p,[group.id]:!isOpen}))}>
                    <div className="sb-group-label">
                      <span className="sb-group-icon">{group.icon}</span>
                      {group.label}
                      {hasActive&&<span style={{width:4,height:4,borderRadius:"50%",background:"#60a5fa",display:"inline-block"}}/>}
                    </div>
                    <span className={`sb-group-caret${isOpen?" open":""}`}>▶</span>
                  </div>
                  {isOpen&&<div className="sb-group-items">
                    {group.items.map(n=>(
                      <div key={n.id} className={`sb-row${view===n.id&&!detail?" act":""}`} onClick={()=>{setView(n.id);setDetail(null);}}>
                        <div className="sb-rl">
                          <span className="sb-ri" style={{fontSize:13}}>{n.icon}</span>
                          <div className="sb-rtxt">
                            <div className="sb-rlbl" style={{fontSize:11.5}}>{n.label}</div>
                          </div>
                        </div>
                        {n.badge&&<span className={`sb-badge ${n.bc||"bg-grey"}`}>{n.badge}</span>}
                      </div>
                    ))}
                  </div>}
                </div>
              );
            })}

            {/* Maturity quick-filter */}
            <div className="sb-div" style={{margin:"8px 10px 6px"}}/>
            <div className="sb-sec" style={{padding:"4px 8px 5px"}}>Quick Filter</div>
            {[
              {id:"urgent",icon:"🔴",label:"Urgent / Overdue",badge:counts.urgent,bc:counts.urgent>0?"bg-red":"bg-grey"},
              {id:"soon",icon:"🕐",label:"Due Soon",badge:counts.soon,bc:counts.soon>0?"bg-amber":"bg-grey"},
              {id:"ok",icon:"✅",label:"Current",badge:counts.ok,bc:"bg-green"},
            ].map(f=>(
              <div key={f.id} className={`sb-row${view==="loans"&&sbFilt===f.id&&!detail?" act":""}`}
                onClick={()=>{setView("loans");setSbFilt(f.id);setDetail(null);}}>
                <div className="sb-rl">
                  <span className="sb-ri" style={{fontSize:12}}>{f.icon}</span>
                  <div className="sb-rtxt"><div className="sb-rlbl" style={{fontSize:11.5}}>{f.label}</div></div>
                </div>
                <span className={`sb-badge ${f.bc}`}>{f.badge}</span>
              </div>
            ))}
          </>)}
        </div>

        <div className="sb-ft">
          <div className="sb-user">
            <div className="sb-av">{user?.user_metadata?.full_name?.[0]||user?.email?.[0]?.toUpperCase()||"M"}</div>
            <div style={{flex:1,minWidth:0}}>
              <div className="sb-uname" style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{user?.user_metadata?.full_name||user?.email?.split("@")[0]||"Management"}</div>
              <div className="sb-urole">{user?.email||"Brooklyn Portfolio"}</div>
            </div>
            {supabase&&<button onClick={signOut} title="Sign out" style={{background:"none",border:"none",cursor:"pointer",color:"var(--sb-t3)",fontSize:14,padding:"4px",flexShrink:0,opacity:.7,transition:"opacity .15s"}}
              onMouseEnter={e=>e.currentTarget.style.opacity="1"}
              onMouseLeave={e=>e.currentTarget.style.opacity=".7"}>
              ⎋
            </button>}
          </div>
        </div>
      </div>

      {/* ── MAIN ── */}
      <div className="main">
        <div className="topbar">
          <div className="tb-title">{topbarTitle}</div>
          <div className="tb-right">
            {detail&&<button className="btn-light" onClick={()=>setDetail(null)}>← Back</button>}
            {detail&&<button className="btn-light" onClick={()=>setAdding(true)}>+ Log Activity</button>}
            {!detail&&view!=="calc"&&<>
              {(view==="loans"||view==="overview")&&loans.length>0&&<button className="btn-light" onClick={exportPortfolioCSV}>⬇ Export CSV</button>}
              <button className="btn-dark" onClick={()=>setAdding(true)}>+ Add Loan</button>
            </>}
          </div>
        </div>

        <div className="carea">
          {detail
            ? <LoanDetail
                raw={detailRaw}
                onBack={()=>setDetail(null)}
                onSave={(id,ch)=>saveLoan(id,ch)}
                onEdit={()=>setEditing(detailRaw)}
                onDelete={()=>deleteLoan(detailRaw.id)}
              />
            : view==="overview"?<Overview loans={loans} onSelect={openLoan} onAdd={()=>setAdding(true)} dbStatus={dbStatus} dbError={dbError}/>
            : view==="loans"?<AllLoans loans={loans} onSelect={openLoan} onAdd={()=>setAdding(true)}/>
            : view==="calc"?<RefiCalc loans={loans}/>
            : view==="pipeline"?<RefiPipeline loans={loans} onSelect={openLoan} onSave={saveLoan}/>
            : view==="cashflow"?<CashflowImpact loans={loans} onSelect={openLoan}/>
            : view==="noidscr"?<NOIDSCRTracker loans={loans} onSelect={openLoan}/>
            : view==="covenant"?<CovenantMonitor loans={loans} onSelect={openLoan}/>
            : view==="alerts"?<AlertSystem loans={loans}/>
            : view==="ratecap"?<RateCapTracker loans={loans} onSelect={openLoan}/>
            : view==="lendercrm"?<LenderCRM loans={loans} onSelect={openLoan}/>
            : view==="contacts"?<ContactsView loans={loans} onSelect={openLoan}/>
            : view==="propdocs"?<DocumentsView loans={loans}/>
            : view==="stmtanalyzer"?<StatementAnalyzer loans={loans}/>
            : view==="markets"?<MarketDataView/>
            : view==="docai"?<LoanDocAbstract loans={loans} onSelect={openLoan}/>
            : view==="timeline"?<MaturityTimeline loans={loans} onSelect={openLoan}/>
            : view==="schedule"?<LoanMaturitySchedule loans={loans} onSelect={openLoan}/>
            : view==="exposure"?<LenderExposure loans={loans} onSelect={openLoan}/>
            : null
          }
        </div>
      </div>
    </div>

    {/* Add Loan Modal */}
    {adding&&!detail&&<LoanModal onSave={l=>{addLoan(l);setAdding(false);}} onClose={()=>setAdding(false)}/>}

    {/* Edit Loan Modal */}
    {editing&&<LoanModal initial={editing} onSave={(id,ch)=>{saveLoan(id,ch);setEditing(null);}} onClose={()=>setEditing(null)}/>}

    {/* Log Activity Modal (from detail view) */}
    {adding&&detail&&<div className="ov-modal" onClick={e=>e.target===e.currentTarget&&setAdding(false)}>
      <div className="ov-mbox">
        <div className="ov-mhd"><div className="ov-mtitle">Log Activity — {detailRaw.addr}</div><button className="ov-mclose" onClick={()=>setAdding(false)}>✕</button></div>
        <div className="ov-mbody">
          <ActivityLog log={detailRaw.activityLog||[]} onAdd={e=>{saveLoan(detailRaw.id,{actAdd:e});}} onDel={id=>saveLoan(detailRaw.id,{actDel:id})}/>
        </div>
      </div>
    </div>}
  </>
  </AuthGate>);
}
