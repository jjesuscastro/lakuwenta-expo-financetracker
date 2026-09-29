import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated, Easing, Platform, Pressable, SafeAreaView, ScrollView, StyleSheet, Switch, Text, TextInput, View, useWindowDimensions } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { fromByteArray } from 'base64-js';

const API = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000';
const TABS: Tab[] = ['Overview', 'Expenses', 'Goals', 'Debts', 'Reports'];
type Category = { id: string; name: string; archived: boolean };
type Transaction = { id: string; type: string; name: string; amount: string; date: string; categoryId: string | null; categoryName: string | null; goalId?: string | null; goalName?: string | null; debtId?: string | null; debtName?: string | null };
type Goal = { id: string; name: string; targetAmount: string; saved: string };
type Debt = { id: string; name: string; direction: 'OWED_BY_ME' | 'OWED_TO_ME'; startingAmount: string; balance: string };
type Report = { month: string; expenses: string; debtPayments: string; debtCollections: string; totalOutflow: string; categories: { categoryId: string; name: string; amount: string; previousAmount: string; changePercent: number | null; isNew: boolean }[] };
type Tab = 'Overview' | 'Expenses' | 'Goals' | 'Debts' | 'Reports' | 'Settings';
type EntryMode = 'EXPENSE' | 'GOAL' | 'DEBT' | 'NEW_GOAL' | 'NEW_DEBT';

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const currentMonth = () => today().slice(0, 7);
const money = (value?: string) => `\u20B1${Number(value || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const comparisonText = (item: Report['categories'][number]) => item.isNew
  ? 'New this month'
  : item.changePercent === null
    ? 'No spending last month'
    : item.changePercent > 0
      ? `Spent ${item.changePercent}% more on ${item.name} this month than last month`
      : item.changePercent < 0
        ? `Spent ${Math.abs(item.changePercent)}% less on ${item.name} this month than last month`
        : `Same spending on ${item.name} as last month`;
const message = (text: string) => Platform.OS === 'web' ? window.alert(text) : Alert.alert('LaKuwenta', text);
const ThemeContext = createContext(false);

function useAppStyles() {
  const dark = useContext(ThemeContext);
  return useMemo(() => createStyles(dark), [dark]);
}

export default function App() {
  const { width } = useWindowDimensions();
  const wide = width >= 960;
  const [token, setToken] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [tab, setTab] = useState<Tab>('Overview');
  const [mobileTopBarHidden, setMobileTopBarHidden] = useState(false);
  const previousScrollY = useRef(0);
  const downwardScrollDistance = useRef(0);
  const topBarHeight = useRef(new Animated.Value(76)).current;
  const [darkMode, setDarkMode] = useState(false);
  const [entryMode, setEntryMode] = useState<EntryMode>('EXPENSE');
  const [entryGoalId, setEntryGoalId] = useState('');
  const [entryDebtId, setEntryDebtId] = useState('');
  const [goalFilter, setGoalFilter] = useState('all');
  const [debtFilter, setDebtFilter] = useState('all');
  const [month, setMonth] = useState(currentMonth());
  const [categories, setCategories] = useState<Category[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [activities, setActivities] = useState<Transaction[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [debts, setDebts] = useState<Debt[]>([]);
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);
  const [expenseName, setExpenseName] = useState('');
  const [expenseAmount, setExpenseAmount] = useState('');
  const [expenseCategory, setExpenseCategory] = useState('');
  const [expenseDate, setExpenseDate] = useState(today());
  const [editingExpenseId, setEditingExpenseId] = useState<string | null>(null);
  const [categoryName, setCategoryName] = useState('');
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [newCategoryMode, setNewCategoryMode] = useState(false);
  const [goalName, setGoalName] = useState('');
  const [goalTarget, setGoalTarget] = useState('');
  const [contributionAmount, setContributionAmount] = useState('');
  const [debtName, setDebtName] = useState('');
  const [debtAmount, setDebtAmount] = useState('');
  const [debtDirection, setDebtDirection] = useState<Debt['direction']>('OWED_BY_ME');
  const [debtEntry, setDebtEntry] = useState<Record<string, string>>({});
  const styles = useMemo(() => createStyles(darkMode), [darkMode]);

  const api = useCallback(async (path: string, init: RequestInit = {}) => {
    const response = await fetch(`${API}${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...init.headers } });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || `Request failed (${response.status})`);
    }
    if (response.status === 204) return null;
    return response.json();
  }, [token]);

  const refresh = useCallback(async () => {
    if (!token) return;
    const [cats, txs, goalList, debtList, monthReport, activityList] = await Promise.all([
      api('/categories'), api(`/transactions?month=${month}`), api('/goals'), api('/debts'), api(`/reports/monthly?month=${month}`), api('/activity'),
    ]);
    setCategories(cats); setTransactions(txs); setGoals(goalList); setDebts(debtList); setReport(monthReport); setActivities(activityList);
    if (!expenseCategory && cats.find((item: Category) => !item.archived)) setExpenseCategory(cats.find((item: Category) => !item.archived).id);
  }, [token, api, month, expenseCategory]);

  useEffect(() => { AsyncStorage.getItem('lakuenta-token').then((saved) => { if (saved) setToken(saved); }); }, []);
  useEffect(() => { AsyncStorage.getItem('lakuenta-dark-mode').then((saved) => { if (saved !== null) setDarkMode(saved === 'true'); }); }, []);
  useEffect(() => {
    const animation = Animated.timing(topBarHeight, { toValue: mobileTopBarHidden && !wide ? 0 : 76, duration: 180, easing: Easing.out(Easing.quad), useNativeDriver: false });
    animation.start();
    return () => animation.stop();
  }, [mobileTopBarHidden, topBarHeight, wide]);
  useEffect(() => { refresh().catch((cause) => message(cause.message)); }, [refresh]);

  async function login() {
    setBusy(true);
    try {
      const response = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not sign in');
      await AsyncStorage.setItem('lakuenta-token', data.token); setToken(data.token); setPassword('');
    } catch (cause) { message((cause as Error).message); }
    finally { setBusy(false); }
  }

  async function perform(action: () => Promise<unknown>, success?: string) {
    setBusy(true);
    try { await action(); await refresh(); if (success) message(success); }
    catch (cause) { message((cause as Error).message); }
    finally { setBusy(false); }
  }

  async function addExpense() {
    await perform(async () => {
      await api(editingExpenseId ? `/transactions/${editingExpenseId}` : '/transactions', { method: editingExpenseId ? 'PATCH' : 'POST', body: JSON.stringify({ name: expenseName, amount: expenseAmount, date: expenseDate, categoryId: expenseCategory }) });
      setExpenseName(''); setExpenseAmount(''); setEditingExpenseId(null);
    });
  }

  async function addCategoryFromExpense() {
    setBusy(true);
    try {
      const created = await api('/categories', { method: 'POST', body: JSON.stringify({ name: categoryName }) });
      setCategoryName(''); setNewCategoryMode(false);
      await refresh();
      if (created?.id) setExpenseCategory(created.id);
    } catch (cause) { message((cause as Error).message); }
    finally { setBusy(false); }
  }

  async function submitOverviewEntry() {
    if (entryMode === 'EXPENSE') return addExpense();
    if (entryMode === 'GOAL') {
      return perform(async () => {
        await api(`/goals/${entryGoalId}/contributions`, { method: 'POST', body: JSON.stringify({ name: 'Savings contribution', amount: contributionAmount, date: today() }) });
        setContributionAmount('');
      });
    }
    if (entryMode === 'DEBT') {
      const debt = debts.find((item) => item.id === entryDebtId);
      if (!debt) return;
      const name = debt.direction === 'OWED_BY_ME' ? 'Debt payment' : 'Debt collection';
      return perform(async () => {
        await api(`/debts/${debt.id}/entries`, { method: 'POST', body: JSON.stringify({ name, amount: debtEntry[debt.id], date: today() }) });
        setDebtEntry((old) => ({ ...old, [debt.id]: '' }));
      });
    }
    if (entryMode === 'NEW_GOAL') {
      return perform(async () => {
        const created = await api('/goals', { method: 'POST', body: JSON.stringify({ name: goalName, targetAmount: goalTarget }) });
        setEntryGoalId(created?.id || ''); setGoalName(''); setGoalTarget(''); setEntryMode('GOAL');
      });
    }
    return perform(async () => {
      const created = await api('/debts', { method: 'POST', body: JSON.stringify({ name: debtName, direction: debtDirection, startingAmount: debtAmount }) });
      setEntryDebtId(created?.id || ''); setDebtName(''); setDebtAmount(''); setEntryMode('DEBT');
    });
  }

  async function exportPdf() {
    setBusy(true);
    try {
      const response = await fetch(`${API}/reports/monthly.pdf?month=${month}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) throw new Error('Could not generate report');
      const blob = await response.blob();
      if (Platform.OS === 'web') {
        const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `lakuenta-${month}.pdf`; link.click(); URL.revokeObjectURL(url);
      } else {
        const uri = `${FileSystem.cacheDirectory}lakuenta-${month}.pdf`;
        await FileSystem.writeAsStringAsync(uri, fromByteArray(new Uint8Array(await blob.arrayBuffer())), { encoding: FileSystem.EncodingType.Base64 });
        if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: `LaKuwenta ${month} report` });
        else message('PDF saved to the app cache, but sharing is unavailable on this device.');
      }
    } catch (cause) { message((cause as Error).message); }
    finally { setBusy(false); }
  }

  async function signOut() { await AsyncStorage.removeItem('lakuenta-token'); setToken(null); }
  const activeCategories = useMemo(() => categories.filter((item) => !item.archived), [categories]);
  const expenseTransactions = transactions.filter((item) => item.type === 'EXPENSE');
  const goalActivities = activities.filter((item) => item.type === 'GOAL_CONTRIBUTION' && (goalFilter === 'all' || item.goalId === goalFilter));
  const debtActivities = activities.filter((item) => (item.type === 'DEBT_PAYMENT' || item.type === 'DEBT_COLLECTION') && (debtFilter === 'all' || item.debtId === debtFilter));

  const handleContentScroll = (event: any) => {
    if (wide) return;
    const nextY = Math.max(0, event.nativeEvent.contentOffset.y);
    const delta = nextY - previousScrollY.current;
    if (delta > 0) {
      downwardScrollDistance.current += delta;
      if (downwardScrollDistance.current >= 56) setMobileTopBarHidden(true);
    } else if (delta < 0) {
      downwardScrollDistance.current = 0;
      setMobileTopBarHidden(false);
    }
    if (nextY === 0) {
      downwardScrollDistance.current = 0;
      setMobileTopBarHidden(false);
    }
    previousScrollY.current = nextY;
  };
  const pageCopy: Record<Tab, string> = {
    Overview: 'Your spending at a glance.',
    Expenses: 'Keep everyday spending organized.',
    Goals: 'Build toward the things that matter.',
    Debts: 'Track balances and every repayment.',
    Reports: 'Review your month and spot changes.',
    Settings: 'Manage your expense categories.',
  };

  if (!token) return <ThemeContext.Provider value={darkMode}><SafeAreaView style={styles.loginPage}>
    <View style={styles.loginHeader}><Brand /></View>
    <View style={styles.loginPanel}>
      <View style={styles.loginCopy}><Text style={styles.loginTitle}>Welcome back</Text></View>
      <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" placeholder="you@example.com" />
      <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry placeholder="Your password" />
      <Button label={busy ? 'Signing in...' : 'Sign in'} onPress={login} disabled={busy} />
    </View>
  </SafeAreaView></ThemeContext.Provider>;

  return <ThemeContext.Provider value={darkMode}><SafeAreaView style={styles.page}>
    <View style={[styles.appLayout, wide && styles.appLayoutWide]}>
      {wide && <View style={styles.sidebar}>
        <Brand />
        <Text style={styles.navCaption}>YOUR FINANCES</Text>
        <Navigation tab={tab} setTab={setTab} vertical />
        <View style={styles.sidebarFooter}><Text style={styles.sidebarFooterTitle}>Made for clarity</Text><Text style={styles.sidebarFooterText}>All amounts are shown in Philippine pesos.</Text></View>
      </View>}
      <View style={styles.main}>
        <Animated.View style={[styles.topBar, { height: topBarHeight }]}>
          {!wide && <Brand compact />}
          <View style={styles.accountArea}><Pressable accessibilityRole="button" accessibilityLabel={tab === 'Settings' ? 'Return to overview' : 'Open settings'} onPress={() => setTab(tab === 'Settings' ? 'Overview' : 'Settings')} style={styles.avatar}><Text style={styles.avatarText}>LK</Text></Pressable><Pressable onPress={signOut} style={styles.signOutButton}><Text style={styles.signOut}>Sign out</Text></Pressable></View>
        </Animated.View>
        {!wide && <Navigation tab={tab} setTab={setTab} />}
        <ScrollView style={styles.contentScroll} contentContainerStyle={[styles.content, wide && styles.contentWide]} onScroll={handleContentScroll} scrollEventThrottle={16}>
          <PageHeading title={tab} subtitle={pageCopy[tab]} action={(tab === 'Overview' || tab === 'Expenses' || tab === 'Reports') ? <MonthPicker month={month} setMonth={setMonth} /> : undefined} />
          {busy && <View style={styles.loading}><ActivityIndicator color="#176b52" /><Text style={styles.loadingText}>Updating...</Text></View>}

          {tab === 'Overview' && <>
            <Card title="Quick entry" subtitle="Record an expense, savings contribution, or debt activity.">
              <View style={styles.chips}>
                <Chip label="Expense" selected={entryMode === 'EXPENSE'} onPress={() => setEntryMode('EXPENSE')} />
                <Chip label="Goal contribution" selected={entryMode === 'GOAL'} onPress={() => setEntryMode('GOAL')} />
                <Chip label="Debt payment / collection" selected={entryMode === 'DEBT'} onPress={() => setEntryMode('DEBT')} />
                <Chip label="New goal" selected={entryMode === 'NEW_GOAL'} onPress={() => setEntryMode('NEW_GOAL')} />
                <Chip label="New debt" selected={entryMode === 'NEW_DEBT'} onPress={() => setEntryMode('NEW_DEBT')} />
              </View>

              {entryMode === 'EXPENSE' && <>
                <Field label="Name or description" value={expenseName} onChangeText={setExpenseName} placeholder="e.g. Weekly grocery shop" />
                <View style={wide ? styles.fieldRow : styles.fieldsColumn}>
                  <Field inline={wide} label="Amount (PHP)" value={expenseAmount} onChangeText={setExpenseAmount} keyboardType="decimal-pad" placeholder="0.00" />
                  <Field inline={wide} label="Date" value={expenseDate} onChangeText={setExpenseDate} placeholder="YYYY-MM-DD" />
                </View>
                <View style={styles.fieldGroup}>
                  <Text style={styles.label}>Category</Text>
                  <View style={styles.chips}>{activeCategories.map((item) => <Chip key={item.id} label={item.name} selected={expenseCategory === item.id} onPress={() => setExpenseCategory(item.id)} />)}
                    <Pressable onPress={() => { setNewCategoryMode((value) => !value); setCategoryName(''); }} style={styles.newCategoryOption}><Text style={styles.newCategoryText}>{newCategoryMode ? 'Cancel new category' : '+ New Category'}</Text></Pressable>
                  </View>
                  {newCategoryMode && <View style={styles.inlineForm}><View style={styles.inlineInput}><Field label="Category name" value={categoryName} onChangeText={setCategoryName} placeholder="e.g. Health" autoCapitalize="words" /></View><Button label="Add" onPress={addCategoryFromExpense} disabled={busy || !categoryName.trim()} /></View>}
                </View>
              </>}

              {entryMode === 'GOAL' && <>
                {goals.length ? <View style={styles.fieldGroup}><Text style={styles.label}>Savings goal</Text><View style={styles.chips}>{goals.map((goal) => <Chip key={goal.id} label={goal.name} selected={entryGoalId === goal.id} onPress={() => setEntryGoalId(goal.id)} />)}</View></View> : <Text style={styles.hint}>Create a goal first using New goal.</Text>}
                <Field label="Contribution amount (PHP)" value={contributionAmount} onChangeText={setContributionAmount} keyboardType="decimal-pad" placeholder="0.00" />
              </>}

              {entryMode === 'DEBT' && <>
                {debts.length ? <View style={styles.fieldGroup}><Text style={styles.label}>Debt</Text><View style={styles.chips}>{debts.map((debt) => <Chip key={debt.id} label={`${debt.name} - ${debt.direction === 'OWED_BY_ME' ? 'You owe' : 'Owed to you'}`} selected={entryDebtId === debt.id} onPress={() => setEntryDebtId(debt.id)} />)}</View></View> : <Text style={styles.hint}>Create a debt first using New debt.</Text>}
                {entryDebtId && <Field label={debts.find((item) => item.id === entryDebtId)?.direction === 'OWED_BY_ME' ? 'Payment amount (PHP)' : 'Collection amount (PHP)'} value={debtEntry[entryDebtId] || ''} onChangeText={(value) => setDebtEntry((old) => ({ ...old, [entryDebtId]: value }))} keyboardType="decimal-pad" placeholder="0.00" />}
              </>}

              {entryMode === 'NEW_GOAL' && <>
                <Field label="Goal name" value={goalName} onChangeText={setGoalName} placeholder="e.g. Emergency fund" />
                <Field label="Target amount (PHP)" value={goalTarget} onChangeText={setGoalTarget} keyboardType="decimal-pad" placeholder="0.00" />
              </>}

              {entryMode === 'NEW_DEBT' && <>
                <Field label="Debt name" value={debtName} onChangeText={setDebtName} placeholder="e.g. Personal loan" />
                <Field label="Starting balance (PHP)" value={debtAmount} onChangeText={setDebtAmount} keyboardType="decimal-pad" placeholder="0.00" />
                <View style={styles.chips}><Chip label="I owe" selected={debtDirection === 'OWED_BY_ME'} onPress={() => setDebtDirection('OWED_BY_ME')} /><Chip label="Owed to me" selected={debtDirection === 'OWED_TO_ME'} onPress={() => setDebtDirection('OWED_TO_ME')} /></View>
              </>}

              <View style={styles.buttonRow}>
                <Button label={{ EXPENSE: editingExpenseId ? 'Save changes' : 'Save expense', GOAL: 'Add contribution', DEBT: (debts.find((item) => item.id === entryDebtId)?.direction === 'OWED_TO_ME' ? 'Record collection' : 'Record payment'), NEW_GOAL: 'Create goal', NEW_DEBT: 'Save debt' }[entryMode]} onPress={submitOverviewEntry} disabled={busy || (entryMode === 'EXPENSE' && (!expenseName || !expenseAmount || !expenseCategory)) || (entryMode === 'GOAL' && (!goals.length || !entryGoalId || !contributionAmount)) || (entryMode === 'DEBT' && (!entryDebtId || !debtEntry[entryDebtId])) || (entryMode === 'NEW_GOAL' && (!goalName || !goalTarget)) || (entryMode === 'NEW_DEBT' && (!debtName || !debtAmount))} />
                {entryMode === 'EXPENSE' && editingExpenseId && <Button label="Cancel edit" variant="secondary" onPress={() => { setEditingExpenseId(null); setExpenseName(''); setExpenseAmount(''); }} />}
              </View>
            </Card>
            <View style={styles.statGrid}>
              <Stat label="Expenses" value={money(report?.expenses)} detail="Purchases and bills" />
              <Stat label="Debt repayments" value={money(report?.debtPayments)} detail="Money paid toward debt" />
              <Stat label="Total outflow" value={money(report?.totalOutflow)} detail="Expenses plus repayments" accent />
              <Stat label="Debt collected" value={money(report?.debtCollections)} detail="Money collected" />
            </View>
            <View style={[styles.columns, wide && styles.columnsWide]}>
              <Card split={wide} title="Spending by category" subtitle="Compared with last month">
                {report?.categories.length ? report.categories.map((item) => <CategoryComparisonRow key={item.categoryId} item={item} />) : <EmptyState title="No spending yet" message="Your category totals will appear here." />}
              </Card>
              <Card split={wide} title="Recent transactions" subtitle="Latest activity this month">
                {transactions.length ? transactions.slice(0, 8).map((item) => <TransactionRow key={item.id} item={item} />) : <EmptyState title="Nothing recorded yet" message="Add an expense, contribution, or debt entry to get started." />}
              </Card>
            </View>
          </>}

          {tab === 'Expenses' && <>
            <Card title="Expenses" subtitle={`Expenses recorded in ${month}`}>
              {expenseTransactions.length ? expenseTransactions.map((item) => <TransactionRow key={item.id} item={item} onEdit={() => { setEditingExpenseId(item.id); setExpenseName(item.name); setExpenseAmount(item.amount); setExpenseDate(item.date); setExpenseCategory(item.categoryId || ''); setEntryMode('EXPENSE'); setTab('Overview'); }} onDelete={() => perform(() => api(`/transactions/${item.id}`, { method: 'DELETE' }))} />) : <EmptyState title="No expenses this month" message="Your saved expenses will show here." />}
            </Card>
          </>}

          {tab === 'Goals' && <Card title="Savings goals" subtitle="All your goals and current progress.">
            {goals.length ? goals.map((goal) => {
              const progress = Math.min(100, Number(goal.targetAmount) > 0 ? Number(goal.saved) / Number(goal.targetAmount) * 100 : 0);
              return <View key={goal.id} style={styles.listCardRow}>
                <View style={styles.listCardCopy}><Text style={styles.rowTitle}>{goal.name}</Text><Text style={styles.hint}>{money(goal.saved)} saved of {money(goal.targetAmount)}</Text></View>
                <View style={styles.goalProgress}><View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${progress}%` }]} /></View><Text style={styles.progressLabel}>{Math.round(progress)}%</Text></View>
              </View>;
            }) : <EmptyState title="No goals yet" message="Choose New goal in Overview to create one." />}
          </Card>}

          {tab === 'Goals' && <Card title="Contributions" subtitle="All savings contributions, across every month.">
            <View style={styles.chips}><Chip label="All goals" selected={goalFilter === 'all'} onPress={() => setGoalFilter('all')} />{goals.map((goal) => <Chip key={goal.id} label={goal.name} selected={goalFilter === goal.id} onPress={() => setGoalFilter(goal.id)} />)}</View>
            {goalActivities.length ? goalActivities.map((item) => <TransactionRow key={item.id} item={item} onDelete={() => perform(() => api(`/transactions/${item.id}`, { method: 'DELETE' }))} />) : <EmptyState title="No contributions found" message={goalFilter === 'all' ? 'Contributions you record will appear here.' : 'This goal has no contributions yet.'} />}
          </Card>}

          {tab === 'Debts' && <Card title="Debts" subtitle="All balances you owe and are owed.">
            {debts.length ? debts.map((debt) => <View key={debt.id} style={styles.listCardRow}>
              <View style={styles.listCardCopy}><Text style={styles.rowTitle}>{debt.name}</Text><Text style={styles.hint}>{debt.direction === 'OWED_BY_ME' ? 'You owe' : 'Owed to you'}</Text></View>
              <View style={styles.debtBalance}><Text style={styles.balanceLabel}>Remaining</Text><Text style={styles.balanceValue}>{money(debt.balance)}</Text></View>
            </View>) : <EmptyState title="No debts tracked" message="Choose New debt in Overview to add one." />}
          </Card>}

          {tab === 'Debts' && <Card title="Payments and collections" subtitle="All debt activity, across every month.">
            <View style={styles.chips}><Chip label="All debts" selected={debtFilter === 'all'} onPress={() => setDebtFilter('all')} />{debts.map((debt) => <Chip key={debt.id} label={debt.name} selected={debtFilter === debt.id} onPress={() => setDebtFilter(debt.id)} />)}</View>
            {debtActivities.length ? debtActivities.map((item) => <TransactionRow key={item.id} item={item} onDelete={() => perform(() => api(`/transactions/${item.id}`, { method: 'DELETE' }))} />) : <EmptyState title="No debt activity found" message={debtFilter === 'all' ? 'Payments and collections you record will appear here.' : 'This debt has no payments or collections yet.'} />}
          </Card>}

          {tab === 'Reports' && <>
            <View style={styles.statGrid}>
              <Stat label="Expenses" value={money(report?.expenses)} />
              <Stat label="Debt repayments" value={money(report?.debtPayments)} />
              <Stat label="Total outflow" value={money(report?.totalOutflow)} accent />
              <Stat label="Debt collected" value={money(report?.debtCollections)} />
            </View>
            <Card title="Monthly comparison" subtitle="Category spending compared with the previous month." action={<Button label="Export PDF" onPress={exportPdf} disabled={busy} />}>
              {report?.categories.length ? report.categories.map((item) => <CategoryComparisonRow key={item.categoryId} item={item} />) : <EmptyState title="No spending to report" message="Once you record expenses, your monthly comparison will appear here." />}
            </Card>
          </>}

          {tab === 'Settings' && <>
            <Card title="Appearance" subtitle="Choose a theme for this device.">
              <View style={styles.settingRow}><View style={styles.listCardCopy}><Text style={styles.rowTitle}>Dark mode</Text><Text style={styles.hint}>{darkMode ? 'Dark appearance is on.' : 'Use a darker color scheme.'}</Text></View><Switch value={darkMode} onValueChange={async (value) => { setDarkMode(value); await AsyncStorage.setItem('lakuenta-dark-mode', String(value)); }} trackColor={{ false: '#cbd5ce', true: '#4d9673' }} thumbColor={darkMode ? '#ffffff' : undefined} /></View>
            </Card>
            <Card title="Categories" subtitle="Add, rename, restore, or archive expense categories.">
              <View style={styles.inlineForm}><View style={styles.inlineInput}><Field label={editingCategoryId ? 'Rename category' : 'New category'} value={categoryName} onChangeText={setCategoryName} placeholder="Category name" /></View><Button label={editingCategoryId ? 'Save' : 'Add'} onPress={() => perform(async () => { await api(editingCategoryId ? `/categories/${editingCategoryId}` : '/categories', { method: editingCategoryId ? 'PATCH' : 'POST', body: JSON.stringify({ name: categoryName }) }); setCategoryName(''); setEditingCategoryId(null); })} disabled={!categoryName.trim()} /></View>
              {categories.map((item) => <View key={item.id} style={styles.categoryManageRow}><Text style={[styles.rowTitle, styles.categoryName]}>{item.name}{item.archived ? ' (archived)' : ''}</Text>{item.archived ? <Pressable onPress={() => perform(() => api(`/categories/${item.id}`, { method: 'PATCH', body: JSON.stringify({ archived: false }) }))}><Text style={styles.actionLink}>Restore</Text></Pressable> : <><Pressable onPress={() => { setCategoryName(item.name); setEditingCategoryId(item.id); }}><Text style={styles.actionLink}>Rename</Text></Pressable><Pressable onPress={() => perform(() => api(`/categories/${item.id}`, { method: 'PATCH', body: JSON.stringify({ archived: true }) }))}><Text style={styles.actionLinkMuted}>Archive</Text></Pressable></>}</View>)}
            </Card>
          </>}
        </ScrollView>
      </View>
    </View>
  </SafeAreaView></ThemeContext.Provider>;
}

function Brand({ compact = false }: { compact?: boolean }) {
  const styles = useAppStyles();
  return <View style={styles.brandLockup}>
    <View style={styles.brandMark}><Text style={styles.brandMarkText}>L</Text></View>
    <View><Text style={[styles.brand, compact && styles.brandCompact]}>LaKuwenta</Text>{!compact && <Text style={styles.brandTagline}>PERSONAL FINANCE</Text>}</View>
  </View>;
}

function Navigation({ tab, setTab, vertical = false }: { tab: Tab; setTab: (value: Tab) => void; vertical?: boolean }) {
  const styles = useAppStyles();
  const items = TABS.map((item) => ({ item, label: item === 'Overview' ? 'Overview' : item }));
  return <View style={vertical ? styles.sideNav : styles.mobileNav}>
    {items.map(({ item, label }) => <Pressable key={item} onPress={() => setTab(item)} style={[
      styles.navItem,
      vertical ? styles.navItemVertical : styles.navItemMobile,
      tab === item && (vertical ? styles.navItemActive : [styles.navItemMobileActive, styles.navItemMobileExpanded]),
    ]}>
      <Text numberOfLines={1} adjustsFontSizeToFit style={[styles.navText, tab === item && styles.navTextActive]}>{label}</Text>
    </Pressable>)}
  </View>;
}

function PageHeading({ title, subtitle, action }: { title: string; subtitle: string; action?: React.ReactNode }) {
  const styles = useAppStyles();
  return <View style={styles.pageHeading}>
    <View style={styles.pageHeadingCopy}><Text style={styles.pageTitle}>{title}</Text><Text style={styles.pageSubtitle}>{subtitle}</Text></View>
    {action && <View style={styles.headingAction}>{action}</View>}
  </View>;
}

function Field(props: React.ComponentProps<typeof TextInput> & { label: string; inline?: boolean }) {
  const styles = useAppStyles();
  const { label, inline = false, ...input } = props;
  return <View style={[styles.field, inline && styles.fieldInline]}>
    <Text style={styles.label}>{label}</Text>
    <TextInput {...input} style={styles.input} placeholderTextColor="#87978f" />
  </View>;
}

function Button({ label, onPress, disabled = false, variant = 'primary' }: { label: string; onPress: () => void; disabled?: boolean; variant?: 'primary' | 'secondary' }) {
  const styles = useAppStyles();
  return <Pressable onPress={onPress} disabled={disabled} style={[styles.button, variant === 'secondary' && styles.buttonSecondary, disabled && styles.buttonDisabled]}>
    <Text style={[styles.buttonText, variant === 'secondary' && styles.buttonTextSecondary]}>{label}</Text>
  </Pressable>;
}

function Card({ title, subtitle, action, split = false, children }: { title: string; subtitle?: string; action?: React.ReactNode; split?: boolean; children: React.ReactNode }) {
  const styles = useAppStyles();
  return <View style={[styles.card, split && styles.cardSplit]}>
    <View style={styles.cardHeader}>
      <View style={styles.cardHeading}><Text style={styles.cardTitle}>{title}</Text>{subtitle && <Text style={styles.cardSubtitle}>{subtitle}</Text>}</View>
      {action && <View style={styles.cardAction}>{action}</View>}
    </View>
    {children}
  </View>;
}

function Stat({ label, value, detail, accent = false }: { label: string; value: string; detail?: string; accent?: boolean }) {
  const styles = useAppStyles();
  return <View style={[styles.stat, accent && styles.statAccent]}>
    <Text style={[styles.statLabel, accent && styles.statAccentLabel]}>{label}</Text><Text style={[styles.statValue, accent && styles.statAccentValue]}>{value}</Text>
    {detail && <Text style={[styles.statDetail, accent && styles.statAccentDetail]}>{detail}</Text>}
  </View>;
}

function EmptyState({ title, message }: { title: string; message: string }) {
  const styles = useAppStyles();
  return <View style={styles.emptyState}><View style={styles.emptyMark}><Text style={styles.emptyMarkText}>L</Text></View><Text style={styles.emptyTitle}>{title}</Text><Text style={styles.emptyMessage}>{message}</Text></View>;
}

function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const styles = useAppStyles();
  return <Pressable onPress={onPress} style={[styles.chip, selected && styles.chipSelected]}><Text style={selected ? styles.chipTextSelected : styles.chipText}>{label}</Text></Pressable>;
}

function MonthPicker({ month, setMonth }: { month: string; setMonth: (value: string) => void }) {
  const styles = useAppStyles();
  const moveMonth = (delta: number) => {
    const date = new Date(`${month}-01T00:00:00Z`);
    date.setUTCMonth(date.getUTCMonth() + delta);
    setMonth(date.toISOString().slice(0, 7));
  };
  const label = new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-PH', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  return <View style={styles.monthPicker}>
    <Pressable accessibilityLabel="Previous month" onPress={() => moveMonth(-1)} style={styles.monthButton}><Text style={styles.monthArrow}>{'\u2039'}</Text></Pressable>
    <Text style={styles.monthText}>{label}</Text>
    <Pressable accessibilityLabel="Next month" onPress={() => moveMonth(1)} style={styles.monthButton}><Text style={styles.monthArrow}>{'\u203A'}</Text></Pressable>
  </View>;
}

function CategoryComparisonRow({ item }: { item: Report['categories'][number] }) {
  const styles = useAppStyles();
  const positive = (item.changePercent ?? 0) > 0;
  return <View style={styles.comparisonRow}>
    <View style={styles.comparisonCopy}><Text style={styles.rowTitle}>{item.name}</Text><Text style={styles.hint}>{comparisonText(item)}</Text></View>
    <View style={styles.comparisonValues}><Text style={styles.rowAmount}>{money(item.amount)}</Text><Text style={[styles.comparisonDelta, positive && styles.comparisonUp]}>{item.isNew ? 'NEW' : item.changePercent === null ? '\u2014' : `${item.changePercent > 0 ? '+' : ''}${item.changePercent}%`}</Text></View>
  </View>;
}

function TransactionRow({ item, onDelete, onEdit }: { item: Transaction; onDelete?: () => void; onEdit?: () => void }) {
  const styles = useAppStyles();
  const kind = item.categoryName || (item.type === 'GOAL_CONTRIBUTION'
    ? `Contribution - ${item.goalName || 'Savings goal'}`
    : item.type === 'DEBT_PAYMENT'
      ? `Payment - ${item.debtName || 'Debt'}`
      : item.type === 'DEBT_COLLECTION'
        ? `Collection - ${item.debtName || 'Debt'}`
        : item.type.replaceAll('_', ' ').toLowerCase());
  return <View style={styles.transactionRow}>
    <View style={styles.transactionGlyph}><Text style={styles.transactionGlyphText}>{(item.categoryName || item.type).slice(0, 1).toUpperCase()}</Text></View>
    <View style={styles.transactionCopy}><Text style={styles.rowTitle}>{item.name}</Text><Text style={styles.hint}>{item.date} {'\u00B7'} {kind}</Text></View>
    <Text style={styles.rowAmount}>{money(item.amount)}</Text>
    {onEdit && <Pressable onPress={onEdit} style={styles.rowAction}><Text style={styles.actionLink}>Edit</Text></Pressable>}
    {onDelete && <Pressable onPress={onDelete} style={styles.rowAction}><Text style={styles.actionLinkMuted}>Delete</Text></Pressable>}
  </View>;
}

function createStyles(dark = false) {
  const definitions = {
  page: { flex: 1, backgroundColor: '#f5f7f5' },
  appLayout: { flex: 1 },
  appLayoutWide: { flexDirection: 'row' },
  sidebar: { width: 248, paddingHorizontal: 22, paddingTop: 28, paddingBottom: 22, backgroundColor: '#fff', borderRightWidth: 1, borderRightColor: '#e8ece8' },
  main: { flex: 1, minWidth: 0 },
  brandLockup: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  brandMark: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#176b52' },
  brandMarkText: { color: '#fff', fontSize: 20, fontWeight: '800' },
  brand: { color: '#183c30', fontSize: 21, fontWeight: '800', letterSpacing: -0.6 },
  brandCompact: { fontSize: 19 },
  brandTagline: { color: '#98a69f', fontSize: 9, fontWeight: '700', letterSpacing: 1.1, marginTop: 2 },
  topBar: { height: 76, flexShrink: 0, overflow: 'hidden', paddingHorizontal: 32, borderBottomWidth: 1, borderBottomColor: '#e8ece8', backgroundColor: '#fff', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  accountArea: { marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 13 },
  avatar: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: '#e7f1eb' },
  avatarText: { color: '#176b52', fontSize: 12, fontWeight: '800' },
  signOutButton: { paddingVertical: 9, paddingHorizontal: 6 },
  signOut: { color: '#587066', fontSize: 13, fontWeight: '600' },
  navCaption: { color: '#9aa8a0', fontSize: 10, fontWeight: '800', letterSpacing: 1, marginTop: 45, marginBottom: 12 },
  sideNav: { flexDirection: 'column', gap: 5 },
  mobileNav: { flexShrink: 0, flexDirection: 'row', alignItems: 'stretch', paddingHorizontal: 10, paddingTop: 6, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#e8ece8' },
  navItem: { justifyContent: 'center', paddingHorizontal: 8 },
  navItemMobile: { flex: 0.9, minWidth: 0, minHeight: 44, alignItems: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  navItemVertical: { width: '100%', minHeight: 42, alignItems: 'flex-start', borderRadius: 9 },
  navItemActive: { backgroundColor: '#e9f3ed' },
  navItemMobileActive: { borderBottomColor: '#176b52' },
  navItemMobileExpanded: { flex: 1.45 },
  navText: { color: '#667a70', fontSize: 13, fontWeight: '600', textAlign: 'center' },
  navTextActive: { color: '#176b52', fontWeight: '700' },
  sidebarFooter: { marginTop: 'auto', padding: 15, borderRadius: 12, backgroundColor: '#f5f8f5' },
  sidebarFooterTitle: { color: '#385c4c', fontSize: 12, fontWeight: '700' },
  sidebarFooterText: { color: '#87968e', fontSize: 11, lineHeight: 16, marginTop: 5 },
  contentScroll: { flex: 1, minHeight: 0 },
  content: { width: '100%', maxWidth: 780, alignSelf: 'center', paddingHorizontal: 18, paddingTop: 22, paddingBottom: 52, gap: 18 },
  contentWide: { maxWidth: 1180, paddingHorizontal: 34, paddingTop: 30, gap: 20 },
  pageHeading: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 14, marginBottom: 2 },
  pageHeadingCopy: { flex: 1, minWidth: 180 },
  pageTitle: { color: '#1c372d', fontSize: 27, lineHeight: 34, fontWeight: '700', letterSpacing: -0.6 },
  pageSubtitle: { color: '#7c8b83', fontSize: 14, marginTop: 4 },
  subtitle: { color: '#7c8b83', fontSize: 14 },
  headingAction: { marginLeft: 'auto' },
  loading: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  loadingText: { color: '#84948b', fontSize: 12 },
  columns: { gap: 16 },
  columnsWide: { flexDirection: 'row', alignItems: 'flex-start' },
  fieldRow: { flexDirection: 'row', gap: 12 },
  fieldsColumn: { gap: 14 },
  card: { width: '100%', minWidth: 0, gap: 16, padding: 20, borderRadius: 15, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e7ece8' },
  cardSplit: { flex: 1 },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 2 },
  cardHeading: { flex: 1, gap: 4 },
  cardAction: { alignItems: 'flex-end' },
  cardTitle: { color: '#233d32', fontSize: 16, fontWeight: '700' },
  cardSubtitle: { color: '#89978f', fontSize: 12, lineHeight: 17 },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  stat: { flexGrow: 1, flexBasis: '44%', minWidth: 145, padding: 17, borderRadius: 14, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e7ece8' },
  statAccent: { backgroundColor: '#176b52', borderColor: '#176b52' },
  statLabel: { color: '#798981', fontSize: 12, fontWeight: '600' },
  statValue: { color: '#203d31', fontSize: 24, fontWeight: '800', letterSpacing: -0.5, marginTop: 8 },
  statDetail: { color: '#9aa69f', fontSize: 11, marginTop: 5 },
  statAccentLabel: { color: '#d3e5dc' },
  statAccentValue: { color: '#fff' },
  statAccentDetail: { color: '#c6dfd3' },
  comparisonRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#e8ece9' },
  comparisonCopy: { flex: 1, minWidth: 0 },
  comparisonValues: { minWidth: 96, alignItems: 'flex-end', gap: 4 },
  comparisonDelta: { color: '#788981', fontSize: 10, fontWeight: '700', letterSpacing: 0.4 },
  comparisonUp: { color: '#b56c49' },
  rowTitle: { color: '#2c4439', fontSize: 13, fontWeight: '600' },
  rowAmount: { color: '#243f33', fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] },
  hint: { color: '#8c9992', fontSize: 11, lineHeight: 16, marginTop: 4 },
  transactionRow: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#e8ece9' },
  transactionGlyph: { width: 34, height: 34, borderRadius: 11, backgroundColor: '#edf4ef', justifyContent: 'center', alignItems: 'center' },
  transactionGlyphText: { color: '#39705a', fontSize: 13, fontWeight: '800' },
  transactionCopy: { flex: 1, minWidth: 0 },
  rowAction: { paddingHorizontal: 2, paddingVertical: 6 },
  actionLink: { color: '#176b52', fontSize: 12, fontWeight: '700' },
  actionLinkMuted: { color: '#9b7770', fontSize: 12, fontWeight: '600' },
  categoryManageRow: { flexDirection: 'row', alignItems: 'center', gap: 13, minHeight: 38, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#edf0ed' },
  categoryName: { flex: 1 },
  listCardRow: { flexDirection: 'row', alignItems: 'center', gap: 18, minHeight: 62, paddingVertical: 11, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#e8ece9' },
  listCardCopy: { flex: 1, minWidth: 0 },
  settingRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  goalProgress: { width: 170, flexDirection: 'row', alignItems: 'center', gap: 10 },
  debtBalance: { minWidth: 116, alignItems: 'flex-end', gap: 3 },
  field: { width: '100%', gap: 7 },
  fieldInline: { flex: 1, minWidth: 0 },
  fieldGroup: { gap: 9 },
  label: { color: '#5e7167', fontSize: 12, fontWeight: '700' },
  input: { width: '100%', minHeight: 44, borderWidth: 1, borderColor: '#dfe7e1', borderRadius: 9, paddingHorizontal: 12, paddingVertical: 10, color: '#243d32', backgroundColor: '#fff', fontSize: 14, outlineStyle: 'none' } as any,
  buttonRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  inlineForm: { flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
  inlineInput: { flex: 1, minWidth: 0 },
  button: { minHeight: 43, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 11, borderRadius: 9, backgroundColor: '#176b52' },
  buttonSecondary: { backgroundColor: '#eef3ef' },
  buttonDisabled: { opacity: 0.48 },
  buttonText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  buttonTextSecondary: { color: '#466357' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  newCategoryOption: { minHeight: 36, justifyContent: 'center', paddingHorizontal: 10, paddingVertical: 8 },
  newCategoryText: { color: '#176b52', fontSize: 12, fontWeight: '700' },
  chip: { minHeight: 36, justifyContent: 'center', paddingHorizontal: 13, paddingVertical: 8, borderWidth: 1, borderColor: '#dfe7e1', borderRadius: 18, backgroundColor: '#fff' },
  chipSelected: { borderColor: '#176b52', backgroundColor: '#e9f3ed' },
  chipText: { color: '#63766c', fontSize: 12, fontWeight: '600' },
  chipTextSelected: { color: '#176b52', fontSize: 12, fontWeight: '700' },
  monthPicker: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 4, borderWidth: 1, borderColor: '#e3e9e4', borderRadius: 11, backgroundColor: '#fff' },
  monthButton: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: 8, backgroundColor: '#f4f7f4' },
  monthArrow: { color: '#416956', fontSize: 23, lineHeight: 26 },
  monthText: { minWidth: 126, textAlign: 'center', color: '#344d40', fontSize: 12, fontWeight: '700' },
  emptyState: { alignItems: 'center', paddingVertical: 20, paddingHorizontal: 14 },
  emptyMark: { width: 38, height: 38, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: '#eff5f0' },
  emptyMarkText: { color: '#5a806c', fontWeight: '800' },
  emptyTitle: { color: '#344d40', fontSize: 13, fontWeight: '700', marginTop: 10 },
  emptyMessage: { maxWidth: 280, color: '#89978f', fontSize: 12, lineHeight: 17, textAlign: 'center', marginTop: 5 },
  goalList: { flex: 1, gap: 16 },
  progressTrack: { height: 8, overflow: 'hidden', borderRadius: 8, backgroundColor: '#edf2ee' },
  progressFill: { height: '100%', borderRadius: 8, backgroundColor: '#4d9673' },
  progressLabel: { color: '#829188', fontSize: 11 },
  balanceRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 11, paddingHorizontal: 13, borderRadius: 10, backgroundColor: '#f5f8f5' },
  balanceLabel: { color: '#7b8b82', fontSize: 12 },
  balanceValue: { color: '#263f34', fontSize: 17, fontWeight: '800' },
  loginPage: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 22, backgroundColor: '#f2f6f2' },
  loginHeader: { alignItems: 'center', marginBottom: 14 },
  loginPanel: { width: '90%', maxWidth: 420, marginTop: 8, padding: 32, gap: 18, borderRadius: 18, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e5ebe6' },
  loginCopy: { gap: 5, marginBottom: 2 },
  loginTitle: { color: '#203a2f', fontSize: 23, fontWeight: '700' },
  };
  if (!dark) return StyleSheet.create(definitions as any);
  const remap = (value: string, property: string) => {
    if (!value.startsWith('#')) return value;
    if (property === 'backgroundColor') {
      if (value === '#176b52' || value === '#4d9673') return value;
      if (value === '#fff' || value === '#ffffff') return '#1b2821';
      const lightBackgrounds = ['#f5f7f5','#f2f6f2','#e7f1eb','#f5f8f5','#edf4ef','#e9f3ed','#eef3ef','#f4f7f4','#eff5f0','#edf2ee'];
      return lightBackgrounds.includes(value.toLowerCase()) ? (value === '#f5f7f5' || value === '#f2f6f2' ? '#111a15' : '#27372e') : value;
    }
    if (property.toLowerCase().includes('border') && property.toLowerCase().endsWith('color')) return '#3a4a40';
    if (property === 'color') {
      if (value === '#fff' || value === '#ffffff') return '#ffffff';
      if (['#176b52','#39705a','#416956','#5a806c'].includes(value.toLowerCase())) return '#79c69b';
      if (['#b56c49','#a85d3f','#9b7770'].includes(value.toLowerCase())) return '#e4a087';
      const hex = value.replace('#', '');
      if (hex.length === 6) {
        const channels = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
        const luminance = channels.reduce((sum, channel) => sum + channel, 0) / 3;
        return luminance < 0.4 ? '#e3ece5' : luminance < 0.68 ? '#b5c2b9' : '#cbd6cf';
      }
    }
    return value;
  };
  const darkDefinitions = Object.fromEntries(Object.entries(definitions).map(([name, definition]) => [name,
    Object.fromEntries(Object.entries(definition as object).map(([property, value]) => [property,
      typeof value === 'string' && property.toLowerCase().endsWith('color') ? remap(value, property) : value,
    ])),
  ]));
  return StyleSheet.create(darkDefinitions as any);
}
