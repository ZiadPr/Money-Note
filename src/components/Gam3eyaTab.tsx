import React, { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Users,
  Plus,
  CheckCircle,
  Circle,
  Trash2,
  Calendar,
  ArrowDownRight,
  ArrowUpRight,
  ChevronLeft,
} from 'lucide-react';

export default function Gam3eyaTab({
  gam3eyat,
  setGam3eyat,
  setShowAddGam3eyaModal,
  t,
  currentTheme,
  formatCurrency,
  currency,
  lang,
  addTransactionDirectly,
  requestConfirmation,
}: any) {
  const [showCompleteConfirm, setShowCompleteConfirm] = useState(false);
  const [pendingCompletion, setPendingCompletion] = useState<{ gam3eya: any } | null>(null);
  const [selectedGam3eyaId, setSelectedGam3eyaId] = useState<string | null>(null);

  const getPaidMonths = (gam3eya: any) => gam3eya.members.filter((member: any) => member.isPaid).length;
  const isGam3eyaCompleted = (gam3eya: any) =>
    Boolean(gam3eya.isCompleted) || getPaidMonths(gam3eya) >= gam3eya.totalMonths;
  const hasReceivedPayout = (gam3eya: any) => Boolean(gam3eya.payoutReceived);
  const getDisplayMonth = (gam3eya: any) => {
    const paidMonths = getPaidMonths(gam3eya);
    return Math.min(gam3eya.totalMonths, Math.max(1, paidMonths + (isGam3eyaCompleted(gam3eya) ? 0 : 1)));
  };

  const buildUpdatedGam3eya = (gam3eya: any, members: any[]) => {
    const allPaid = members.every((member: any) => member.isPaid);
    return {
      ...gam3eya,
      members,
      isCompleted: allPaid,
      payoutReceived: allPaid ? Boolean(gam3eya.payoutReceived) : false,
      currentMonth: Math.min(
        gam3eya.totalMonths,
        Math.max(1, members.filter((member: any) => member.isPaid).length + (allPaid ? 0 : 1)),
      ),
    };
  };

  const activeGam3eyat = useMemo(
    () => gam3eyat.filter((gam: any) => !isGam3eyaCompleted(gam)),
    [gam3eyat],
  );

  const totalMonthlyCommitment = useMemo(
    () => activeGam3eyat.reduce((sum: number, gam: any) => sum + gam.monthlyAmount, 0),
    [activeGam3eyat],
  );

  const nextPayoutGam3eya = useMemo(() => {
    const sorted = [...activeGam3eyat].sort((first: any, second: any) => {
      const firstProgress = getPaidMonths(first);
      const secondProgress = getPaidMonths(second);
      return secondProgress - firstProgress;
    });

    return sorted[0] || null;
  }, [activeGam3eyat]);

  const selectedGam3eya = selectedGam3eyaId
    ? gam3eyat.find((gam: any) => gam.id === selectedGam3eyaId) || null
    : null;

  const toggleMonthPaid = (gam3eyaId: string, memberId: string) => {
    const gam3eya = gam3eyat.find((gam: any) => gam.id === gam3eyaId);
    if (!gam3eya || hasReceivedPayout(gam3eya)) {
      return;
    }

    const updatedMembers = gam3eya.members.map((member: any) =>
      member.id === memberId ? { ...member, isPaid: !member.isPaid } : member,
    );
    const updatedGam3eya = buildUpdatedGam3eya(gam3eya, updatedMembers);

    if (updatedGam3eya.isCompleted && !isGam3eyaCompleted(gam3eya)) {
      setPendingCompletion({ gam3eya: updatedGam3eya });
      setShowCompleteConfirm(true);
      return;
    }

    setGam3eyat(
      gam3eyat.map((gam: any) => (gam.id === gam3eyaId ? updatedGam3eya : gam)),
    );
  };

  const confirmCompletion = () => {
    if (!pendingCompletion) {
      return;
    }

    handleReceivePayout({ ...pendingCompletion.gam3eya, isCompleted: true });
    setShowCompleteConfirm(false);
    setPendingCompletion(null);
  };

  const cancelCompletion = () => {
    setShowCompleteConfirm(false);
    setPendingCompletion(null);
  };

  const handleDeleteGam3eya = (id: string) => {
    requestConfirmation({
      title: lang === 'ar' ? 'حذف الجمعية؟' : 'Delete money pool?',
      message:
        lang === 'ar'
          ? 'سيتم حذف الجمعية وكل تقدم الأقساط المسجل لها.'
          : 'This will remove the pool and all recorded installment progress.',
      confirmLabel: lang === 'ar' ? 'حذف الجمعية' : 'Delete pool',
      tone: 'danger',
      onConfirm: () => {
        setGam3eyat((current: any[]) => current.filter((gam: any) => gam.id !== id));
        if (selectedGam3eyaId === id) {
          setSelectedGam3eyaId(null);
        }
      },
    });
  };

  const handlePayMonthly = (gam3eya: any) => {
    if (isGam3eyaCompleted(gam3eya)) {
      return;
    }

    const firstUnpaid = gam3eya.members.find((member: any) => !member.isPaid);
    if (!firstUnpaid) {
      return;
    }

    addTransactionDirectly(
      `${lang === 'ar' ? 'دفع قسط جمعية' : 'Gam3eya installment'}: ${gam3eya.name}`,
      gam3eya.monthlyAmount,
      'expense',
    );
    toggleMonthPaid(gam3eya.id, firstUnpaid.id);
  };

  const handleReceivePayout = (gam3eya: any) => {
    if (!isGam3eyaCompleted(gam3eya) || hasReceivedPayout(gam3eya)) {
      return;
    }

    const totalPayout = gam3eya.monthlyAmount * gam3eya.totalMonths;
    addTransactionDirectly(
      `${lang === 'ar' ? 'استلام قبض جمعية' : 'Gam3eya payout'}: ${gam3eya.name}`,
      totalPayout,
      'income',
    );

    setGam3eyat(
      gam3eyat.map((item: any) =>
        item.id === gam3eya.id
          ? {
              ...item,
              ...gam3eya,
              isCompleted: true,
              payoutReceived: true,
              currentMonth: gam3eya.totalMonths,
            }
          : item,
      ),
    );
  };

  const renderOverview = () => (
    <div className="flex flex-1 flex-col gap-4">
      <div className="flex items-end justify-between gap-3 px-1">
        <div>
          <p className="text-[0.75rem] text-text-secondary">
            {lang === 'ar' ? 'الجمعيات والمواعيد القادمة' : 'Track pools, dues, and payout turns'}
          </p>
          <h2 className={`text-[1.25rem] font-bold ${currentTheme.text || 'text-slate-50'}`}>{t.gam3eya}</h2>
        </div>
        <button
          type="button"
          onClick={() => setShowAddGam3eyaModal(true)}
          className="touch-icon-button rounded-2xl bg-sky-500/20 text-sky-400"
          aria-label={t.addGam3eya}
        >
          <Plus className="h-5 w-5" />
        </button>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="mobile-card border border-white/10 bg-white/[0.03] p-4">
          <p className="text-[0.65rem] font-bold uppercase tracking-[0.2em] text-text-secondary">{t.activePools}</p>
          <p className="mt-2 text-xl font-extrabold text-text-primary">{activeGam3eyat.length}</p>
        </div>
        <div className="mobile-card border border-white/10 bg-white/[0.03] p-4">
          <p className="text-[0.65rem] font-bold uppercase tracking-[0.2em] text-text-secondary">{t.monthlyCommitment}</p>
          <p className="mt-2 text-sm font-extrabold text-text-primary">
            {formatCurrency(totalMonthlyCommitment, currency, lang, false)}
          </p>
        </div>
        <div className="mobile-card border border-white/10 bg-white/[0.03] p-4">
          <p className="text-[0.65rem] font-bold uppercase tracking-[0.2em] text-text-secondary">{t.nextPayout}</p>
          <p className="mt-2 truncate text-sm font-extrabold text-text-primary">
            {nextPayoutGam3eya ? nextPayoutGam3eya.name : '--'}
          </p>
        </div>
      </div>

      {gam3eyat.length === 0 ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="mobile-card flex h-56 flex-col items-center justify-center gap-4 border border-white/5 bg-white/[0.02] p-8 text-center text-slate-500"
        >
          <Users className="h-10 w-10 opacity-30" />
          <button
            type="button"
            onClick={() => setShowAddGam3eyaModal(true)}
            className="min-h-11 rounded-full bg-accent-primary px-5 text-sm font-bold text-text-on-accent"
          >
            {t.addGam3eya}
          </button>
          <p className="text-sm">{lang === 'ar' ? 'لا توجد جمعيات حاليًا.' : 'No money pools yet.'}</p>
        </motion.div>
      ) : (
        <div className="space-y-4">
          {gam3eyat.map((gam3eya: any) => {
            const paidMonths = getPaidMonths(gam3eya);
            const isCompleted = isGam3eyaCompleted(gam3eya);
            const payoutReceived = hasReceivedPayout(gam3eya);
            const progress = gam3eya.totalMonths ? Math.round((paidMonths / gam3eya.totalMonths) * 100) : 0;

            return (
              <motion.div
                key={gam3eya.id}
                initial={{ y: 18, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                className={`mobile-card overflow-hidden border border-glass-border bg-glass-bg p-5 ${isCompleted ? 'opacity-70' : ''}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="truncate text-lg font-bold text-text-primary">
                      {gam3eya.name}
                      {isCompleted ? ` • ${payoutReceived ? (lang === 'ar' ? 'تم القبض' : 'Payout received') : t.completed}` : ''}
                    </h3>
                    <p className="mt-1 text-xs text-text-secondary">
                      {formatCurrency(gam3eya.monthlyAmount, currency, lang, false)}
                      {' • '}
                      {paidMonths}/{gam3eya.totalMonths}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDeleteGam3eya(gam3eya.id)}
                    className="touch-icon-button text-text-secondary"
                    aria-label={lang === 'ar' ? 'حذف الجمعية' : 'Delete pool'}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>

                <div className="mt-4 space-y-2">
                  <div className="flex items-center justify-between text-[0.7rem] font-semibold text-text-secondary">
                    <span>{t.monthsProgress}</span>
                    <span>{progress}%</span>
                  </div>
                  <div className="h-2 rounded-full bg-white/8">
                    <div
                      className="h-2 rounded-full bg-accent-primary transition-all"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedGam3eyaId(gam3eya.id)}
                    className="min-h-11 rounded-2xl border border-white/10 bg-white/5 px-4 text-xs font-bold text-text-primary"
                  >
                    {t.openDetails}
                  </button>

                  {!isCompleted ? (
                    <button
                      type="button"
                      onClick={() => handlePayMonthly(gam3eya)}
                      className="min-h-11 rounded-2xl bg-rose-500/10 px-4 text-xs font-bold text-rose-300"
                    >
                      {lang === 'ar' ? 'دفع القسط' : 'Pay installment'}
                    </button>
                  ) : payoutReceived ? (
                    <div className="flex min-h-11 items-center justify-center rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 text-center text-xs font-bold text-emerald-300">
                      {lang === 'ar' ? 'تم تسجيل القبض' : 'Payout recorded'}
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleReceivePayout(gam3eya)}
                      className="min-h-11 rounded-2xl bg-emerald-500/10 px-4 text-xs font-bold text-emerald-300"
                    >
                      {lang === 'ar' ? 'استلام القبض' : 'Receive payout'}
                    </button>
                  )}
                </div>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );

  const renderDetails = (gam3eya: any) => {
    const isCompleted = isGam3eyaCompleted(gam3eya);
    const payoutReceived = hasReceivedPayout(gam3eya);

    return (
      <motion.div
        key={gam3eya.id}
        initial={{ x: lang === 'ar' ? -24 : 24, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: lang === 'ar' ? -24 : 24, opacity: 0 }}
        className="flex flex-1 flex-col gap-4"
      >
        <div className="flex items-center justify-between gap-3 px-1">
          <button
            type="button"
            onClick={() => setSelectedGam3eyaId(null)}
            className="touch-icon-button border border-white/10 bg-white/5 text-text-primary"
            aria-label={t.back}
          >
            <ChevronLeft className="h-5 w-5 rtl:rotate-180" />
          </button>
          <div className="min-w-0 flex-1 text-center">
            <p className="text-[0.75rem] text-text-secondary">{t.gam3eyaDetails}</p>
            <h2 className="truncate text-[1.25rem] font-bold text-text-primary">{gam3eya.name}</h2>
          </div>
          <button
            type="button"
            onClick={() => handleDeleteGam3eya(gam3eya.id)}
            className="touch-icon-button border border-white/10 bg-white/5 text-text-secondary"
            aria-label={lang === 'ar' ? 'حذف الجمعية' : 'Delete pool'}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="mobile-card border border-white/10 bg-white/[0.03] p-4">
            <p className="text-xs text-text-secondary">{t.monthlyAmount}</p>
            <p className="mt-2 text-base font-bold text-text-primary">
              {formatCurrency(gam3eya.monthlyAmount, currency, lang, false)}
            </p>
          </div>
          <div className="mobile-card border border-white/10 bg-white/[0.03] p-4">
            <p className="text-xs text-text-secondary">{t.currentMonth}</p>
            <p className="mt-2 text-base font-bold text-text-primary">
              {getDisplayMonth(gam3eya)}/{gam3eya.totalMonths}
            </p>
          </div>
        </div>

        {!isCompleted ? (
          <button
            type="button"
            onClick={() => handlePayMonthly(gam3eya)}
            className="min-h-11 rounded-2xl bg-rose-500/10 px-4 text-xs font-bold text-rose-300"
          >
            <span className="inline-flex items-center gap-2">
              <ArrowUpRight className="h-4 w-4" />
              {lang === 'ar' ? 'دفع القسط' : 'Pay installment'}
            </span>
          </button>
        ) : payoutReceived ? (
          <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-4 text-center text-sm font-bold text-emerald-300">
            <span className="inline-flex items-center gap-2">
              <ArrowDownRight className="h-4 w-4" />
              {lang === 'ar' ? 'تم تسجيل قبض الجمعية ولا يمكن تعديل الشهور بعد ذلك.' : 'Payout was recorded. Monthly installments are now locked.'}
            </span>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => handleReceivePayout(gam3eya)}
            className="min-h-11 rounded-2xl bg-emerald-500/10 px-4 text-xs font-bold text-emerald-300"
          >
            <span className="inline-flex items-center gap-2">
              <ArrowDownRight className="h-4 w-4" />
              {lang === 'ar' ? 'استلام القبض' : 'Receive payout'}
            </span>
          </button>
        )}

        <div className="space-y-3">
          {gam3eya.members.map((member: any, index: number) => (
            <div key={member.id} className="mobile-card flex items-center justify-between border border-white/10 bg-white/[0.03] p-4">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => toggleMonthPaid(gam3eya.id, member.id)}
                  disabled={payoutReceived}
                  className={`transition-colors ${
                    payoutReceived
                      ? 'cursor-not-allowed text-slate-600'
                      : member.isPaid
                        ? 'text-emerald-400'
                        : 'text-slate-500 hover:text-slate-300'
                  }`}
                  aria-label={member.isPaid ? t.markPaid : lang === 'ar' ? 'تعليم الشهر كمدفوع' : 'Mark month as paid'}
                >
                  {member.isPaid ? <CheckCircle className="h-5 w-5" /> : <Circle className="h-5 w-5" />}
                </button>
                <div>
                  <p className={`font-semibold ${member.isPaid ? 'line-through opacity-50' : 'text-text-primary'}`}>
                    {lang === 'ar' ? `الشهر ${index + 1}` : `Month ${index + 1}`}
                  </p>
                  <p className="text-xs text-text-secondary">
                    <span className="inline-flex items-center gap-1">
                      <Calendar className="h-3.5 w-3.5" />
                      {formatCurrency(gam3eya.monthlyAmount, currency, lang, false)}
                    </span>
                  </p>
                </div>
              </div>
              <span className={`text-xs font-bold ${member.isPaid ? 'text-emerald-400' : 'text-text-secondary'}`}>
                {member.isPaid ? (lang === 'ar' ? 'تم الدفع' : 'Paid') : (lang === 'ar' ? 'في الانتظار' : 'Pending')}
              </span>
            </div>
          ))}
        </div>
      </motion.div>
    );
  };

  return (
    <div className="flex flex-1 flex-col gap-4">
      <AnimatePresence mode="wait">
        {selectedGam3eya ? renderDetails(selectedGam3eya) : renderOverview()}
      </AnimatePresence>

      <AnimatePresence>
        {showCompleteConfirm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md"
          >
            <motion.div
              initial={{ scale: 0.95 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.95 }}
              className={`w-full max-w-sm rounded-3xl border border-white/10 bg-gradient-to-br ${currentTheme.card} p-6 text-center shadow-2xl`}
            >
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/20">
                <CheckCircle className="h-8 w-8 text-emerald-400" />
              </div>
              <h3 className={`mb-2 text-xl font-bold ${currentTheme.text || 'text-white'}`}>
                {lang === 'ar' ? 'إكمال الجمعية' : 'Complete money pool'}
              </h3>
              <p className="mb-6 text-sm text-slate-400">
                {lang === 'ar'
                  ? 'تم دفع كل الأقساط. هل تريد إكمال الجمعية واستلام مبلغ القبض الآن؟'
                  : 'All installments are paid. Do you want to complete this pool and receive the payout now?'}
              </p>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={cancelCompletion}
                  className="flex-1 rounded-xl bg-white/5 py-3 font-bold text-slate-300 transition-colors hover:bg-white/10"
                >
                  {t.cancel}
                </button>
                <button
                  type="button"
                  onClick={confirmCompletion}
                  className="flex-1 rounded-xl bg-emerald-500 py-3 font-bold text-white transition-colors hover:bg-emerald-400"
                >
                  {lang === 'ar' ? 'تأكيد واستلام' : 'Confirm & Receive'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
