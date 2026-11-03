import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import {
  LayoutDashboard, ShoppingBag, ReceiptText, Settings, Search, Plus, Minus,
  Trash2, ChevronDown, ArrowUpRight, Sparkles, Package, Clock3, CreditCard,
  Banknote, Smartphone, X, Printer, RefreshCw, Menu, LogOut, ShieldAlert,
  ShieldCheck, Wifi, WifiOff, Users
} from 'lucide-react';
import './style.css';
import { Inventory, Reports, Share, calc, SalesCharts, TeamManager } from './features.jsx';
import { CustomerPage, InvoiceEditor, customerKey } from './editors.jsx';
import {
  auth, googleProvider, signInWithPopup, signOut, onAuthStateChanged,
  db, doc, collection, onSnapshot, setDoc, deleteDoc, handleFirestoreError,
  OperationType
} from './firebase.js';

const site = 'https://www.poppybluefragrances.com';
const logo = 'https://www.poppybluefragrances.com/cdn/shop/files/Poppy_Blue_Logo_Square_Emblem.png?height=144&v=1780842662';
const ADMIN_EMAILS = [
  'ashketchupkeke@gmail.com',
  'poppyblueshopify@gmail.com',
  'owaiskhan722@gmail.com'
];

const fallback = [
  ['Caden Perfume', 'Caden.png?v=1783232186', 250],
  ['Black Tie Perfume', 'Black-tie.jpg?v=1780829077', 250],
  ['Amaris Perfume', 'Amaris.jpg?v=1782805076', 290],
  ['Dayton Perfume', 'Dayton_cde4369d-b9d2-4efd-b24f-885db2c11386.png?v=1783261938', 290],
  ['1001 Night Attar', 'ChatGPTImageSep19_2026_02_01_46AM.png?v=1789833426', 900],
  ['1881 Attar', '1881.png?v=1783324313', 500]
].map(([title, img, price], i) => ({
  id: 'sample-' + i,
  title,
  images: [{ src: `${site}/cdn/shop/files/${img}` }],
  variants: [{ id: 'sample-' + i, title: 'Starting price', price, available: true }]
}));

const money = n => '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const getLocal = (key, def) => { try { return JSON.parse(localStorage.getItem(key)) ?? def; } catch { return def; } };

function App() {
  // Auth & Connection State
  const [currentUser, setCurrentUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authorizedUsers, setAuthorizedUsers] = useState([]);
  const [isOnline, setIsOnline] = useState(() => (typeof navigator !== 'undefined' ? navigator.onLine : true));

  // POS State (initialized with local cache / fallback for fast boot and offline reliability)
  const [products, setProducts] = useState(() => getLocal('pb-products', fallback));
  const [source, setSource] = useState('Connecting to store…');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('All products');
  const [cart, setCart] = useState([]);
  const [view, setView] = useState('Point of sale');
  const [selected, setSelected] = useState({});
  const [customer, setCustomer] = useState('');
  const [phone, setPhone] = useState('');
  const [payment, setPayment] = useState('Cash');
  const [showInvoice, setShowInvoice] = useState(null);
  const [invoices, setInvoices] = useState(() => getLocal('pb-invoices', []));
  const [settings, setSettings] = useState(() => {
    const saved = getLocal('pb-settings', {});
    return { hsn: '', taxType: 'CGST + SGST', ...saved, gst: saved.gst == null || saved.gst === '' ? '18' : saved.gst, gstin: saved.gstin?.trim() || '27ABGFB3604A1Z3' };
  });
  const [mobileNav, setMobileNav] = useState(false);
  const [stock, setStock] = useState(() => getLocal('pb-stock', {}));
  const [config, setConfig] = useState(() => getLocal('pb-product-tax', {}));
  const [discount, setDiscount] = useState('');
  const [customerGstin, setCustomerGstin] = useState('');
  const [quickTab, setQuickTab] = useState('Most sold');
  const [recent, setRecent] = useState(() => getLocal('pb-recent-products', []));
  const [profiles, setProfiles] = useState(() => getLocal('pb-customer-profiles', {}));
  const [editingInvoice, setEditingInvoice] = useState(null);
  const searchRef = useRef(null);

  // Monitor network connectivity
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Monitor Firebase Auth State
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, user => {
      setCurrentUser(user);
      setAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // Subscribe to Authorized Users whitelist from Firestore
  useEffect(() => {
    if (!currentUser) {
      setAuthorizedUsers([]);
      return;
    }
    const unsub = onSnapshot(collection(db, 'authorized_users'), snap => {
      const list = [];
      snap.forEach(d => list.push(d.data()));
      setAuthorizedUsers(list);
    }, err => {
      handleFirestoreError(err, OperationType.LIST, 'authorized_users');
    });
    return () => unsub();
  }, [currentUser]);

  // Determine authorization & role
  const isSuperAdmin = Boolean(currentUser?.email && ADMIN_EMAILS.includes(currentUser.email.toLowerCase()));
  const userRecord = authorizedUsers.find(u => u.email?.toLowerCase() === currentUser?.email?.toLowerCase());
  const isAuthorized = isSuperAdmin || (userRecord && userRecord.active);
  const isAdmin = isSuperAdmin || (userRecord && userRecord.role === 'admin' && userRecord.active);

  // If any designated admin logs in, ensure all designated admin records exist in authorized_users collection
  useEffect(() => {
    if (isSuperAdmin && currentUser) {
      ADMIN_EMAILS.forEach(email => {
        setDoc(doc(db, 'authorized_users', email), {
          email,
          role: 'admin',
          active: true,
          addedAt: new Date().toISOString(),
          addedBy: 'system'
        }, { merge: true }).catch(() => {});
      });
    }
  }, [isSuperAdmin, currentUser]);

  // Real-time Firestore synchronization for authorized users
  useEffect(() => {
    if (!currentUser || !isAuthorized) return;

    // 1. Sync Invoices
    const unsubInvoices = onSnapshot(collection(db, 'invoices'), snap => {
      if (!snap.empty) {
        const cloudInvoices = [];
        snap.forEach(d => cloudInvoices.push(d.data()));
        cloudInvoices.sort((a, b) => new Date(b.date) - new Date(a.date));
        setInvoices(cloudInvoices);
        localStorage.setItem('pb-invoices', JSON.stringify(cloudInvoices));
      } else {
        // Initial migration bridge: upload local saved invoices if cloud is brand new
        const local = getLocal('pb-invoices', []);
        if (local.length > 0) {
          local.forEach(inv => {
            setDoc(doc(db, 'invoices', inv.id), inv).catch(e => handleFirestoreError(e, OperationType.WRITE, `invoices/${inv.id}`));
          });
        }
      }
    }, err => handleFirestoreError(err, OperationType.LIST, 'invoices'));

    // 2. Sync Stock
    const unsubStock = onSnapshot(collection(db, 'stock'), snap => {
      if (!snap.empty) {
        const cloudStock = {};
        snap.forEach(d => { cloudStock[d.id] = d.data(); });
        setStock(cloudStock);
        localStorage.setItem('pb-stock', JSON.stringify(cloudStock));
      } else {
        const local = getLocal('pb-stock', {});
        if (Object.keys(local).length > 0) {
          Object.entries(local).forEach(([id, val]) => {
            setDoc(doc(db, 'stock', id), val).catch(e => handleFirestoreError(e, OperationType.WRITE, `stock/${id}`));
          });
        }
      }
    }, err => handleFirestoreError(err, OperationType.LIST, 'stock'));

    // 3. Sync Product Tax config
    const unsubTax = onSnapshot(collection(db, 'product_tax'), snap => {
      if (!snap.empty) {
        const cloudTax = {};
        snap.forEach(d => { cloudTax[d.id] = d.data(); });
        setConfig(cloudTax);
        localStorage.setItem('pb-product-tax', JSON.stringify(cloudTax));
      } else {
        const local = getLocal('pb-product-tax', {});
        if (Object.keys(local).length > 0) {
          Object.entries(local).forEach(([id, val]) => {
            setDoc(doc(db, 'product_tax', id), val).catch(e => handleFirestoreError(e, OperationType.WRITE, `product_tax/${id}`));
          });
        }
      }
    }, err => handleFirestoreError(err, OperationType.LIST, 'product_tax'));

    // 4. Sync Customers
    const unsubCustomers = onSnapshot(collection(db, 'customers'), snap => {
      if (!snap.empty) {
        const cloudProfiles = {};
        snap.forEach(d => { cloudProfiles[d.id] = d.data(); });
        setProfiles(cloudProfiles);
        localStorage.setItem('pb-customer-profiles', JSON.stringify(cloudProfiles));
      } else {
        const local = getLocal('pb-customer-profiles', {});
        if (Object.keys(local).length > 0) {
          Object.entries(local).forEach(([id, val]) => {
            setDoc(doc(db, 'customers', id), val).catch(e => handleFirestoreError(e, OperationType.WRITE, `customers/${id}`));
          });
        }
      }
    }, err => handleFirestoreError(err, OperationType.LIST, 'customers'));

    // 5. Sync Settings
    const unsubSettings = onSnapshot(doc(db, 'settings', 'store'), snap => {
      if (snap.exists()) {
        const cloudSettings = snap.data();
        setSettings(cloudSettings);
        localStorage.setItem('pb-settings', JSON.stringify(cloudSettings));
      } else {
        const local = getLocal('pb-settings', {
          gstin: '27ABGFB3604A1Z3',
          gst: '18',
          hsn: '',
          taxType: 'CGST + SGST'
        });
        setDoc(doc(db, 'settings', 'store'), local).catch(e => handleFirestoreError(e, OperationType.WRITE, 'settings/store'));
      }
    }, err => handleFirestoreError(err, OperationType.GET, 'settings/store'));

    return () => {
      unsubInvoices();
      unsubStock();
      unsubTax();
      unsubCustomers();
      unsubSettings();
    };
  }, [currentUser, isAuthorized]);

  // Product catalogue fetcher
  const sync = async () => {
    setSource('Connecting to store…');
    try {
      let all = [], page = 1;
      while (true) {
        const res = await fetch(`${site}/products.json?limit=250&page=${page}`);
        if (!res.ok) throw Error();
        let data = await res.json();
        all.push(...data.products);
        if (data.products.length < 250) break;
        page++;
      }
      if (!all.length) throw Error();
      all.sort((a, b) => a.title.localeCompare(b.title));
      setProducts(all);
      localStorage.setItem('pb-products', JSON.stringify(all));
      setSource('Live store catalogue');
    } catch (e) {
      setSource('Catalogue unavailable · showing saved items');
    }
  };

  useEffect(() => { sync(); }, []);
  useEffect(() => localStorage.setItem('pb-recent-products', JSON.stringify(recent)), [recent]);

  // Seed default variant counts into local stock map if unknown
  useEffect(() => {
    setStock(current => {
      let next = { ...current }, changed = false;
      products.forEach(p => {
        if (String(p.id).startsWith('sample-')) return;
        p.variants.forEach(v => {
          const id = String(v.id);
          if (!(id in next)) {
            next[id] = { qty: '10', low: '3', assumed: true };
            changed = true;
          }
        });
      });
      return changed ? next : current;
    });
  }, [products]);

  const type = p => /attar/i.test(p.title) ? 'Attars' : /bonvey|set/i.test(p.title) ? 'Gift sets' : 'Perfumes';
  const filtered = products.filter(p => (category === 'All products' || type(p) === category) && p.title.toLowerCase().includes(search.toLowerCase()));

  const add = (p, variantId) => {
    if (String(p.id).startsWith('sample-')) {
      alert('The full store catalogue could not be loaded. Please reconnect and refresh before billing this item; the displayed price is only the website starting price.');
      return;
    }
    let v = p.variants.find(v => String(v.id) === String(variantId ?? selected[p.id])) || p.variants[0];
    if (!v) return;
    let available = stock[String(v.id)]?.qty, inCart = cart.find(x => x.id === v.id)?.qty || 0;
    if (available !== '' && available != null && inCart >= Number(available)) {
      alert('Not enough local stock for this variant.');
      return;
    }
    setRecent(r => [{ productId: String(p.id), variantId: String(v.id) }, ...r.filter(x => x.variantId !== String(v.id))].slice(0, 12));
    setCart(c => {
      let found = c.find(x => x.id === v.id);
      return found ? c.map(x => x.id === v.id ? { ...x, qty: x.qty + 1 } : x) : [...c, { id: v.id, title: p.title, variant: v.title, price: Number(v.price), image: p.images?.[0]?.src, qty: 1 }];
    });
  };

  const qty = (id, n) => {
    let available = stock[String(id)]?.qty, current = cart.find(x => x.id === id)?.qty || 0;
    if (n > 0 && available !== '' && available != null && current + n > Number(available)) {
      alert('Not enough local stock for this variant.');
      return;
    }
    setCart(c => c.map(x => x.id === id ? { ...x, qty: x.qty + n } : x).filter(x => x.qty > 0));
  };

  const calculated = calc(cart, discount, settings, config);
  const { total, base, tax } = calculated;
  const rate = Number(settings.gst) || 0;

  // Checkout and persist invoice + stock mutations directly to Firestore (with instant local cache write)
  const checkout = async () => {
    if (!cart.length) return;
    const invalid = cart.some(x => {
      const value = config[String(x.id)]?.gst;
      const r = value !== '' && value != null ? value : settings.gst;
      return r === '' || r == null || !Number.isFinite(Number(r)) || Number(r) < 0 || Number(r) > 100;
    });
    if (invalid || !settings.gstin.trim()) {
      alert('Enter your store GSTIN and a valid GST rate in Settings or for each variant in Inventory.');
      return;
    }
    if (customerGstin && !/^[0-9A-Z]{15}$/.test(customerGstin)) {
      alert('Enter a valid 15-character customer GSTIN.');
      return;
    }
    if (Number(discount) < 0 || Number(discount) > calculated.gross) {
      alert('Discount must be between zero and the order subtotal.');
      return;
    }

    const invoiceId = `PB-${Date.now()}`;
    const invoice = {
      id: invoiceId,
      date: new Date().toISOString(),
      ...calculated,
      customerId: customerKey({ customer, phone }) ? (Object.values(profiles).find(p => p.phone && phone && p.phone.trim().toLowerCase() === phone.trim().toLowerCase())?.id || customerKey({ customer, phone })) : null,
      items: calculated.items.map(x => ({ ...x, stockTracked: stock[String(x.id)]?.qty !== '' && stock[String(x.id)]?.qty != null })),
      customer,
      phone,
      customerGstin,
      payment,
      settings: { ...settings },
      createdBy: currentUser?.email || 'cashier',
      createdAt: new Date().toISOString()
    };

    // 1. Update UI state immediately
    setInvoices([invoice, ...invoices]);
    setShowInvoice(invoice);
    setCart([]);
    setCustomer('');
    setPhone('');
    setCustomerGstin('');
    setDiscount('');

    // 2. Persist invoice to Firestore (writes to offline localCache instantly, syncs to cloud automatically)
    try {
      await setDoc(doc(db, 'invoices', invoiceId), invoice);
    } catch (e) {
      handleFirestoreError(e, OperationType.CREATE, `invoices/${invoiceId}`);
    }

    // 3. Update stock levels in Firestore & local state
    const nextStock = { ...stock };
    for (const x of cart) {
      let s = nextStock[String(x.id)];
      if (s?.qty !== '' && s?.qty != null) {
        const updatedStock = { ...s, qty: String(Number(s.qty) - x.qty), assumed: false };
        nextStock[String(x.id)] = updatedStock;
        try {
          await setDoc(doc(db, 'stock', String(x.id)), updatedStock);
        } catch (e) {
          handleFirestoreError(e, OperationType.WRITE, `stock/${x.id}`);
        }
      }
    }
    setStock(nextStock);
  };

  const returnInvoice = async i => {
    if (i.returned || !window.confirm('Record a FULL return for this invoice? This restores tracked stock and excludes the sale from reports. This cannot be undone here.')) return;
    const updated = { ...i, returned: true, returnedAt: new Date().toISOString(), returnedBy: currentUser?.email || 'cashier' };

    setInvoices(all => all.map(x => x.id === i.id ? updated : x));
    setShowInvoice(updated);

    try {
      await setDoc(doc(db, 'invoices', i.id), updated);
    } catch (e) {
      handleFirestoreError(e, OperationType.UPDATE, `invoices/${i.id}`);
    }

    const nextStock = { ...stock };
    for (const x of i.items) {
      let s = nextStock[String(x.id)];
      if (x.stockTracked && s?.qty !== '' && s?.qty != null) {
        const restored = { ...s, qty: String(Number(s.qty) + x.qty) };
        nextStock[String(x.id)] = restored;
        try {
          await setDoc(doc(db, 'stock', String(x.id)), restored);
        } catch (e) {
          handleFirestoreError(e, OperationType.WRITE, `stock/${x.id}`);
        }
      }
    }
    setStock(nextStock);
  };

  const saveInvoice = async updated => {
    let original = invoices.find(i => i.id === updated.id);
    if (!original) return 'Invoice not found.';
    if (original.returned) return 'Returned invoices cannot be edited.';
    for (const item of updated.items) {
      const prior = original.items.find(x => String(x.id) === String(item.id));
      const s = stock[String(item.id)];
      const diff = item.qty - (prior?.qty || 0);
      if (prior?.stockTracked && s?.qty !== '' && s?.qty != null && diff > Number(s.qty)) return `Not enough stock for ${item.title}.`;
    }
    if (!window.confirm('Save this invoice correction? This updates reports and tracked stock.')) return '';

    const { history, ...snapshot } = original;
    let saved = { ...updated, history: [...(history || []), snapshot], editedBy: currentUser?.email || 'cashier', editedAt: new Date().toISOString() };

    setInvoices(all => all.map(i => i.id === saved.id ? saved : i));
    setShowInvoice(saved);
    setEditingInvoice(null);

    try {
      await setDoc(doc(db, 'invoices', saved.id), saved);
    } catch (e) {
      handleFirestoreError(e, OperationType.UPDATE, `invoices/${saved.id}`);
    }

    const nextStock = { ...stock };
    for (const item of saved.items) {
      let prior = original.items.find(x => String(x.id) === String(item.id)), s = nextStock[String(item.id)];
      if (prior?.stockTracked && s?.qty !== '' && s?.qty != null) {
        const adjusted = { ...s, qty: String(Number(s.qty) - (item.qty - prior.qty)) };
        nextStock[String(item.id)] = adjusted;
        try {
          await setDoc(doc(db, 'stock', String(item.id)), adjusted);
        } catch (e) {
          handleFirestoreError(e, OperationType.WRITE, `stock/${item.id}`);
        }
      }
    }
    setStock(nextStock);
    return '';
  };

  // Stock update handler
  const handleStockUpdate = async newStock => {
    setStock(newStock);
    for (const [id, val] of Object.entries(newStock)) {
      if (JSON.stringify(val) !== JSON.stringify(stock[id])) {
        try {
          await setDoc(doc(db, 'stock', String(id)), val);
        } catch (e) {
          handleFirestoreError(e, OperationType.WRITE, `stock/${id}`);
        }
      }
    }
  };

  // Config tax update handler
  const handleConfigUpdate = async newConfig => {
    setConfig(newConfig);
    for (const [id, val] of Object.entries(newConfig)) {
      if (JSON.stringify(val) !== JSON.stringify(config[id])) {
        try {
          await setDoc(doc(db, 'product_tax', String(id)), val);
        } catch (e) {
          handleFirestoreError(e, OperationType.WRITE, `product_tax/${id}`);
        }
      }
    }
  };

  // Customer profile save handler
  const handleCustomerSave = async customerRecord => {
    const nextProfiles = { ...profiles, [customerRecord.id]: customerRecord };
    setProfiles(nextProfiles);
    try {
      await setDoc(doc(db, 'customers', customerRecord.id), customerRecord);
    } catch (e) {
      handleFirestoreError(e, OperationType.WRITE, `customers/${customerRecord.id}`);
    }
  };

  // Settings update handler
  const handleSettingsUpdate = async nextSettings => {
    setSettings(nextSettings);
    try {
      await setDoc(doc(db, 'settings', 'store'), nextSettings);
    } catch (e) {
      handleFirestoreError(e, OperationType.WRITE, 'settings/store');
    }
  };

  // Staff Whitelist handlers
  const handleAddUser = async user => {
    await setDoc(doc(db, 'authorized_users', user.email), {
      ...user,
      addedAt: new Date().toISOString(),
      addedBy: currentUser?.email || 'admin'
    });
  };

  const handleUpdateUser = async (userEmail, updates) => {
    await setDoc(doc(db, 'authorized_users', userEmail), updates, { merge: true });
  };

  const handleDeleteUser = async userEmail => {
    await deleteDoc(doc(db, 'authorized_users', userEmail));
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handler = e => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (showInvoice) return;
        setView('Point of sale');
        setTimeout(() => searchRef.current?.focus(), 0);
      } else if (e.key === 'Escape') {
        if (editingInvoice) setEditingInvoice(null);
        else if (showInvoice) setShowInvoice(null);
        else if (view === 'Point of sale' && document.activeElement === searchRef.current) {
          setSearch('');
          searchRef.current?.blur();
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && view === 'Point of sale' && !showInvoice && cart.length) {
        e.preventDefault();
        if (window.confirm('Create an invoice for the current order?')) checkout();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [view, showInvoice, editingInvoice, cart, settings, config, discount, customer, phone, customerGstin, payment, stock, invoices]);

  const salesCounts = {};
  invoices.filter(i => !i.returned).forEach(i => i.items.forEach(x => {
    const key = String(x.id);
    salesCounts[key] = (salesCounts[key] || 0) + x.qty;
  }));

  const byVariant = new Map(products.filter(p => !String(p.id).startsWith('sample-')).flatMap(p => p.variants.map(v => [String(v.id), { p, v }])));
  const best = Object.entries(salesCounts).sort((a, b) => b[1] - a[1]).map(([id]) => byVariant.get(id)).filter(Boolean).slice(0, 8);
  const recentItems = recent.map(x => byVariant.get(x.variantId)).filter(Boolean).slice(0, 8);
  const quickItems = quickTab === 'Most sold' ? best : recentItems;

  const nav = [
    ['Overview', LayoutDashboard],
    ['Point of sale', ShoppingBag],
    ['Invoices', ReceiptText],
    ['Inventory', Package],
    ['Customers', ShoppingBag],
    ['Reports', LayoutDashboard],
    ['Settings', Settings]
  ];

  const today = invoices.filter(i => new Date(i.date).toDateString() === new Date().toDateString());

  // 1. Initial Authentication Loading State
  if (authLoading) {
    return (
      <div className="auth-overlay">
        <div className="auth-card" style={{ maxWidth: 360 }}>
          <div className="auth-brand">
            <img src={logo} alt="Poppy Blue Fragrances" />
            <strong>POPPY BLUE</strong>
            <small>F R A G R A N C E S</small>
          </div>
          <h2>Loading POS</h2>
          <p>Connecting to store workspace...</p>
        </div>
      </div>
    );
  }

  // 2. Unauthenticated State - Sign In Screen
  if (!currentUser) {
    return (
      <div className="auth-overlay">
        <div className="auth-card">
          <div className="auth-brand">
            <img src={logo} alt="Poppy Blue Fragrances" />
            <strong>POPPY BLUE</strong>
            <small>F R A G R A N C E S</small>
          </div>
          <h2>Staff Portal Login</h2>
          <p>Sign in with your authorized Google account to manage store sales, inventory, and tax invoices.</p>
          <button className="btn-google" onClick={() => signInWithPopup(auth, googleProvider)}>
            <svg viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
            </svg>
            Sign in with Google
          </button>
          <div className="auth-notice">
            Only authorized staff and cashiers on the store whitelist are granted access. Offline database persistence is automatically enabled.
          </div>
        </div>
      </div>
    );
  }

  // 3. Authenticated but Unauthorized User Screen
  if (!isAuthorized) {
    return (
      <div className="auth-overlay">
        <div className="auth-card" style={{ maxWidth: 460 }}>
          <div className="auth-brand">
            <img src={logo} alt="Poppy Blue Fragrances" />
            <strong>POPPY BLUE</strong>
            <small>F R A G R A N C E S</small>
          </div>
          <div className="auth-denied">
            <h3><ShieldAlert size={18} /> Access Restricted</h3>
            <p>
              You are signed in as <strong>{currentUser.email}</strong>, but this account has not been authorized to access the Poppy Blue POS workspace.
            </p>
            <p style={{ marginBottom: 0 }}>
              Please ask a store administrator (<strong>poppyblueshopify@gmail.com</strong>, <strong>owaiskhan722@gmail.com</strong>, or <strong>ashketchupkeke@gmail.com</strong>) to add your email to the staff whitelist.
            </p>
          </div>
          <div className="auth-actions-group">
            <button className="primary" onClick={() => signInWithPopup(auth, googleProvider)}>
              Switch Google Account
            </button>
            <button onClick={() => signOut(auth)}>
              Sign Out
            </button>
          </div>
        </div>
      </div>
    );
  }

  // 4. Authorized Main POS Dashboard with Offline-First Persistence
  return (
    <div className="app">
      <aside className={'sidebar ' + (mobileNav ? 'open' : '')}>
        <div className="brand">
          <img className="brand-logo" src={logo} alt="Poppy Blue logo" />
          <div>
            <strong>POPPY BLUE</strong>
            <small>F R A G R A N C E S</small>
          </div>
        </div>
        <div className="side-label">WORKSPACE</div>
        <nav>
          {nav.map(([n, I]) => (
            <button
              className={view === n ? 'active' : ''}
              key={n}
              onClick={() => { setView(n); setMobileNav(false); }}
            >
              <I size={18} />
              {n}
              {n === 'Point of sale' && <span className="nav-dot" />}
            </button>
          ))}
        </nav>
        <div className="side-bottom">
          <div className="store-icon"><ShoppingBag size={18} /></div>
          <div>
            <strong>Store workspace</strong>
            <small>Jogeshwari, Mumbai</small>
          </div>
          <ChevronDown size={15} />
        </div>
      </aside>

      <main>
        <header>
          <button className="mobile-menu" onClick={() => setMobileNav(!mobileNav)}><Menu /></button>
          <div className="crumb">Workspace <span>/</span> <strong>{view}</strong></div>
          <div className="header-right">
            {/* Real-time Online / Offline status badge */}
            {isOnline ? (
              <span className="status-badge online" title="Firestore connected and synced with cloud">
                <i /> Cloud Synced
              </span>
            ) : (
              <span className="status-badge offline" title="Working offline; changes saved to local database and will auto-sync on reconnect">
                <i /> Offline Mode (Auto-syncs)
              </span>
            )}

            {/* Authenticated user menu */}
            <div className="user-menu">
              <div className="user-details">
                <span>{currentUser.displayName || currentUser.email?.split('@')[0]}</span>
                <small>{isAdmin ? 'Admin' : 'Cashier'}</small>
              </div>
              <div className="avatar" title={currentUser.email}>
                {(currentUser.displayName?.[0] || currentUser.email?.[0] || 'U').toUpperCase()}
              </div>
              <button className="btn-signout" onClick={() => signOut(auth)} title="Sign out of POS">
                <LogOut size={13} />
              </button>
            </div>
          </div>
        </header>

        {view === 'Point of sale' ? (
          <div className="pos-layout">
            <section className="catalog">
              <div className="page-heading">
                <div>
                  <div className="eyebrow">YOUR STORE, SIMPLIFIED <Sparkles size={13} /></div>
                  <h1>Point of sale</h1>
                  <p>Create a new sale and make someone's day.</p>
                </div>
                <div className="datebox">
                  <Clock3 size={16} />
                  {new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                </div>
              </div>

              <div className="catalog-top">
                <div>
                  <h2>Product catalogue <span>{products.length}</span></h2>
                  <p>Explore your collection and add items to the bill.</p>
                </div>
                <button className="sync" onClick={sync} title="Refresh catalogue"><RefreshCw size={15} /></button>
              </div>

              <div className="quick-picks">
                <div className="quick-header">
                  <div>
                    <h2>Quick selection</h2>
                    <p>Choose a variant to add it to your order.</p>
                  </div>
                  <div className="quick-tabs">
                    <button className={quickTab === 'Most sold' ? 'active' : ''} onClick={() => setQuickTab('Most sold')}>Most sold</button>
                    <button className={quickTab === 'Recent' ? 'active' : ''} onClick={() => setQuickTab('Recent')}>Recent</button>
                  </div>
                </div>
                {quickItems.length ? (
                  <div className="quick-list">
                    {quickItems.map(({ p, v }) => (
                      <button key={String(v.id)} className="quick-item" onClick={() => add(p, v.id)}>
                        <img src={p.images?.[0]?.src} alt="" />
                        <span>
                          <strong>{p.title}</strong>
                          <small>{v.title === 'Default Title' ? 'Standard' : v.title} · {money(v.price)}</small>
                        </span>
                        <Plus size={16} />
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="quick-empty">{quickTab === 'Most sold' ? 'Completed sales will appear here.' : 'Recently added products will appear here.'}</p>
                )}
              </div>

              <div className="filters">
                <div className="search">
                  <Search size={18} />
                  <input ref={searchRef} placeholder="Search fragrances..." value={search} onChange={e => setSearch(e.target.value)} />
                  <kbd>Ctrl / ⌘ K</kbd>
                </div>
                <div className="tabs">
                  {['All products', 'Perfumes', 'Attars', 'Gift sets'].map(t => (
                    <button key={t} onClick={() => setCategory(t)} className={category === t ? 'selected' : ''}>{t}</button>
                  ))}
                </div>
              </div>

              <div className="catalog-meta">
                <span>SHOWING {filtered.length} PRODUCTS</span>
                <span><i /> {source}</span>
              </div>

              <div className="product-grid">
                {filtered.map(p => {
                  let v = p.variants.find(v => String(v.id) === String(selected[p.id])) || p.variants[0];
                  return (
                    <article className="product" key={p.id}>
                      <div className="product-image">
                        <span className="product-tag">{type(p) === 'Attars' ? 'ATTAR' : type(p) === 'Gift sets' ? 'GIFT SET' : 'PERFUME'}</span>
                        {p.images?.[0]?.src ? <img src={p.images[0].src} loading="lazy" /> : <div className="no-image"><ShoppingBag size={32} /></div>}
                        <button className="add-float" onClick={() => add(p)} aria-label={'Add ' + p.title}><Plus size={19} /></button>
                      </div>
                      <div className="product-info">
                        <div className="product-category">{type(p).toUpperCase()}</div>
                        {stock[String(v?.id)]?.qty !== '' && stock[String(v?.id)]?.qty != null && Number(stock[String(v?.id)].qty) <= Number(stock[String(v?.id)].low || 0) && (
                          <span className="stock-badge">{Number(stock[String(v?.id)].qty) === 0 ? 'Out of stock' : `Low stock · ${stock[String(v?.id)].qty} left`}</span>
                        )}
                        <h3>{p.title}</h3>
                        <div className="product-bottom">
                          <strong>{money(v?.price)}</strong>
                          {p.variants.length > 1 ? (
                            <select value={selected[p.id] || v?.id} onChange={e => setSelected({ ...selected, [p.id]: e.target.value })}>
                              {p.variants.map(x => <option key={x.id} value={x.id}>{x.title}{x.available === false ? ' · Sold out' : ''}</option>)}
                            </select>
                          ) : (
                            <span>{v?.title === 'Default Title' ? '' : v?.title}</span>
                          )}
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>

              {!filtered.length && <div className="empty-search">No products found. Try a different search.</div>}
              <div className="catalog-footer">Curated with care, for every kind of you. <span>✦</span></div>
            </section>

            <aside className="order">
              <div className="order-heading">
                <div>
                  <div className="eyebrow">LET'S MAKE A SALE</div>
                  <h2>Current order</h2>
                  <p>Build your customer's bill here.</p>
                </div>
                <div className="order-icon"><ReceiptText size={20} /></div>
              </div>

              <div className="order-id">
                <span>NEW ORDER</span>
                <span>● &nbsp; In progress</span>
              </div>

              <div className="cart-items">
                {cart.length === 0 ? (
                  <div className="empty-cart">
                    <div className="empty-icon"><ShoppingBag size={28} /><span>+</span></div>
                    <h3>Your order is empty</h3>
                    <p>Every good scent starts somewhere.<br />Add products to get started.</p>
                  </div>
                ) : (
                  cart.map(item => (
                    <div className="cart-item" key={item.id}>
                      <img src={item.image} />
                      <div className="cart-item-info">
                        <strong>{item.title}</strong>
                        <small>{item.variant === 'Default Title' ? '' : item.variant}</small>
                        <b>{money(item.price)}</b>
                      </div>
                      <div className="qty">
                        <button onClick={() => qty(item.id, -1)}><Minus size={12} /></button>
                        <span>{item.qty}</span>
                        <button onClick={() => qty(item.id, 1)}><Plus size={12} /></button>
                      </div>
                    </div>
                  ))
                )}
              </div>

              <div className="order-details">
                <div className="section-label">CUSTOMER DETAILS <span>OPTIONAL</span></div>
                <div className="customer-inputs">
                  <input placeholder="Customer name" value={customer} onChange={e => setCustomer(e.target.value)} />
                  <input placeholder="Phone number" value={phone} onChange={e => setPhone(e.target.value)} />
                  <input placeholder="Customer GSTIN (optional)" value={customerGstin} maxLength={15} onChange={e => setCustomerGstin(e.target.value.toUpperCase())} />
                  <label className="discount-label">Discount (₹)
                    <input type="number" min="0" max={calculated.gross} value={discount} onChange={e => setDiscount(e.target.value)} placeholder="0.00" />
                  </label>
                </div>

                <div className="section-label payment-label">PAYMENT METHOD</div>
                <div className="payments">
                  {[['Cash', Banknote], ['UPI', Smartphone], ['Card', CreditCard]].map(([x, I]) => (
                    <button className={payment === x ? 'chosen' : ''} onClick={() => setPayment(x)} key={x}>
                      <I size={15} />{x}
                    </button>
                  ))}
                </div>

                <div className="summary">
                  <div><span>Items total</span><span>{money(calculated.gross)}</span></div>
                  <div><span>Discount</span><span>− {money(calculated.discount)}</span></div>
                  <div><span>Subtotal {rate ? '(excl. GST)' : ''}</span><span>{money(base)}</span></div>
                  <div><span>GST (included)</span><span>{money(tax)}</span></div>
                  <div className="total"><strong>Total payable</strong><strong>{money(total)}</strong></div>
                </div>

                <button className="checkout" disabled={!cart.length} onClick={checkout}>
                  Create invoice <ArrowUpRight size={18} />
                </button>
                <p className="secure">Prices include GST · Cloud auto-synced · Ctrl / ⌘ + Enter to create invoice</p>
              </div>
            </aside>
          </div>
        ) : view === 'Inventory' ? (
          <Inventory products={products} stock={stock} setStock={handleStockUpdate} config={config} setConfig={handleConfigUpdate} settings={settings} />
        ) : view === 'Customers' ? (
          <CustomerPage invoices={invoices} profiles={profiles} onSave={handleCustomerSave} onOpen={setShowInvoice} />
        ) : view === 'Reports' ? (
          <Reports invoices={invoices} />
        ) : view === 'Overview' ? (
          <section className="simple-page">
            <div className="eyebrow">WELCOME TO POPPY BLUE</div>
            <h1>Store overview</h1>
            <p>A little look at how your store is doing today.</p>
            <div className="stats">
              <div>
                <span>Today's sales</span>
                <strong>{money(today.filter(i => !i.returned).reduce((s, i) => s + i.total, 0))}</strong>
                <small>From saved invoices today</small>
              </div>
              <div>
                <span>Invoices today</span>
                <strong>{today.filter(i => !i.returned).length}</strong>
                <small>Completed sales</small>
              </div>
              <div>
                <span>Products</span>
                <strong>{products.length}</strong>
                <small>{source}</small>
              </div>
            </div>
            <SalesCharts invoices={invoices} />
            <div className="panel">
              <h2>Ready for your next sale?</h2>
              <p>Browse your fragrance collection and create an invoice in just a few clicks.</p>
              <button className="primary" onClick={() => setView('Point of sale')}>Go to point of sale <ArrowUpRight size={16} /></button>
            </div>
          </section>
        ) : view === 'Invoices' ? (
          <section className="simple-page">
            <div className="eyebrow">YOUR SALES HISTORY</div>
            <h1>Invoices</h1>
            <p>View and print invoices created on any connected terminal.</p>
            <div className="panel invoice-list">
              {invoices.length ? (
                invoices.map(i => (
                  <button key={i.id} onClick={() => setShowInvoice(i)}>
                    <div>
                      <strong>{i.id}</strong>
                      <small>{new Date(i.date).toLocaleString('en-IN')} · {i.customer || 'Walk-in customer'}{i.returned ? ' · RETURNED' : ''}</small>
                    </div>
                    <b>{money(i.total)}</b>
                    <ArrowUpRight size={17} />
                  </button>
                ))
              ) : (
                <div className="empty-cart">
                  <ReceiptText size={28} />
                  <h3>No invoices yet</h3>
                  <p>Completed sales will appear here.</p>
                </div>
              )}
            </div>
          </section>
        ) : (
          <section className="simple-page">
            <div className="eyebrow">STORE PREFERENCES</div>
            <h1>Settings & Team</h1>
            <p>Configure tax parameters and manage authorized cashiers and staff accounts.</p>

            <div className="panel settings-panel">
              <h2>GST details</h2>
              <p>All product prices include GST. Default GST is 18%. Suggested HSN: 33030050 for spirit-based perfumes and 33030040 for non-spirit attar perfumes.</p>
              <label>Store GSTIN
                <input value={settings.gstin} onChange={e => handleSettingsUpdate({ ...settings, gstin: e.target.value.toUpperCase() })} placeholder="Enter your GSTIN" />
              </label>
              <label>GST rate (%)
                <input type="number" min="0" max="100" value={settings.gst} onChange={e => handleSettingsUpdate({ ...settings, gst: e.target.value })} placeholder="Enter applicable rate" />
              </label>
              <label>HSN code (optional)
                <input value={settings.hsn} onChange={e => handleSettingsUpdate({ ...settings, hsn: e.target.value })} placeholder="Enter HSN code" />
              </label>
              <label>Tax type
                <select value={settings.taxType} onChange={e => handleSettingsUpdate({ ...settings, taxType: e.target.value })}>
                  <option>CGST + SGST</option>
                  <option>IGST</option>
                </select>
              </label>
              <small>Settings are saved in the cloud and synced across all store devices.</small>
            </div>

            <TeamManager
              authorizedUsers={authorizedUsers}
              onAddUser={handleAddUser}
              onUpdateUser={handleUpdateUser}
              onDeleteUser={handleDeleteUser}
              currentUser={currentUser}
              isAdmin={isAdmin}
              adminEmails={ADMIN_EMAILS}
            />
          </section>
        )}
      </main>

      {/* Invoice Detail Modal */}
      {showInvoice && (
        <div className="modal-backdrop">
          <div className="modal">
            <div className="modal-actions">
              <strong>Invoice preview</strong>
              <div>
                <Share invoice={showInvoice} />
                {!showInvoice.returned && !showInvoice.isHistorical && (
                  <button onClick={() => setEditingInvoice(showInvoice)}>Edit invoice</button>
                )}
                <button onClick={() => window.print()}><Printer size={16} /> Print / Save PDF</button>
                {!showInvoice.returned && !showInvoice.isHistorical && (
                  <button onClick={() => returnInvoice(showInvoice)}>Record full return</button>
                )}
                <button onClick={() => setShowInvoice(null)}><X size={18} /></button>
              </div>
            </div>

            {showInvoice.history?.length > 0 && (
              <div className="edit-history">
                <details>
                  <summary>Correction history ({showInvoice.history.length})</summary>
                  {showInvoice.history.map((old, index) => (
                    <div key={index}>
                      Previous version · {old.editedAt ? new Date(old.editedAt).toLocaleString('en-IN') : 'original'} · {money(old.total)}{' '}
                      <button onClick={() => setShowInvoice({ ...old, history: undefined, isHistorical: true })}>View</button>
                    </div>
                  ))}
                </details>
              </div>
            )}

            <div className="invoice">
              {showInvoice.isHistorical && <div className="historical-notice">HISTORICAL VERSION · NOT THE CURRENT INVOICE</div>}
              <div className="invoice-head">
                <div>
                  <img className="invoice-logo" src={logo} alt="Poppy Blue Fragrances" />
                  <p>
                    BLACK CLOAK FRAGRANCES LLP<br />
                    Shop 7, Swami Vivekanand Rd, next to McDonalds,<br />
                    opposite Sabri Masjid, Momin Nagar, Jogeshwari West,<br />
                    Mumbai, Maharashtra 400102<br />
                    +91 86557 87401<br />
                    GSTIN: {showInvoice.settings.gstin}
                  </p>
                </div>
                <div className="invoice-title">
                  <h2>TAX INVOICE</h2>
                  <p>{showInvoice.id}<br />{new Date(showInvoice.date).toLocaleString('en-IN')}</p>
                </div>
              </div>

              <div className="bill-to">
                <strong>Bill to</strong>
                <p>
                  {showInvoice.customer || 'Walk-in customer'}
                  {showInvoice.phone && <><br />{showInvoice.phone}</>}
                  {showInvoice.customerGstin && <><br />GSTIN: {showInvoice.customerGstin}</>}
                </p>
                <span>Payment: {showInvoice.payment}{showInvoice.returned ? ' · RETURNED' : ''}</span>
              </div>

              <table>
                <thead>
                  <tr>
                    <th>ITEM</th>
                    <th>QTY</th>
                    <th>RATE</th>
                    <th>HSN / GST</th>
                    <th>AMOUNT</th>
                  </tr>
                </thead>
                <tbody>
                  {showInvoice.items.map(x => (
                    <tr key={x.id}>
                      <td>{x.title}<small>{x.variant === 'Default Title' ? '' : x.variant}</small></td>
                      <td>{x.qty}</td>
                      <td>{money(x.price)}</td>
                      <td>{x.hsn || showInvoice.settings.hsn || '—'} / {x.rate ?? showInvoice.settings.gst}%</td>
                      <td>{money(x.lineTotal ?? x.price * x.qty)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="invoice-summary">
                {showInvoice.discount > 0 && (
                  <>
                    <div><span>Items total</span><b>{money(showInvoice.gross)}</b></div>
                    <div><span>Discount</span><b>− {money(showInvoice.discount)}</b></div>
                  </>
                )}
                <div><span>Taxable value</span><b>{money(showInvoice.base)}</b></div>
                {showInvoice.settings.taxType === 'IGST' ? (
                  <div><span>IGST</span><b>{money(showInvoice.tax)}</b></div>
                ) : (
                  <>
                    <div><span>CGST</span><b>{money(Math.round(showInvoice.tax * 50) / 100)}</b></div>
                    <div><span>SGST</span><b>{money(showInvoice.tax - Math.round(showInvoice.tax * 50) / 100)}</b></div>
                  </>
                )}
                <div className="invoice-total"><span>Total</span><b>{money(showInvoice.total)}</b></div>
              </div>

              {showInvoice.settings.hsn && <p>HSN: {showInvoice.settings.hsn}</p>}
              <div className="thanks">Thank you for choosing Poppy Blue. ✦</div>
            </div>
          </div>
        </div>
      )}

      {/* Invoice Editor Modal */}
      {editingInvoice && (
        <InvoiceEditor
          invoice={editingInvoice}
          onSave={saveInvoice}
          onClose={() => setEditingInvoice(null)}
        />
      )}
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
