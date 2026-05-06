import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { AlertTriangle } from 'lucide-react';
import { useUIStore } from '../store/useUIStore';

export const MarketplaceMismatchModal: React.FC = () => {
  const showMismatchModal = useUIStore((state) => state.showMismatchModal);
  const setShowMismatchModal = useUIStore((state) => state.setShowMismatchModal);
  const mismatchData = useUIStore((state) => state.mismatchData);
  const setUploadDestination = useUIStore((state) => state.setUploadDestination);
  const setShowConfirmModal = useUIStore((state) => state.setShowConfirmModal);

  if (!showMismatchModal || !mismatchData) return null;

  const handleFix = () => {
    setUploadDestination(mismatchData.detected);
    setShowMismatchModal(false);
    setShowConfirmModal(true);
  };

  const handleIgnore = () => {
    setShowMismatchModal(false);
    setShowConfirmModal(true);
  };

  return (
    <AnimatePresence>
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4"
      >
        <motion.div 
          initial={{ scale: 0.95, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.95, opacity: 0, y: 20 }}
          className="bg-white rounded-3xl shadow-2xl max-w-lg w-full overflow-hidden"
        >
          <div className="p-8 pb-6 flex items-center gap-4 bg-amber-50">
            <div className="w-12 h-12 rounded-full bg-amber-100 flex items-center justify-center text-amber-600 shrink-0">
              <AlertTriangle size={24} />
            </div>
            <div>
              <h3 className="text-xl font-bold text-slate-900">Возможная ошибка направления</h3>
            </div>
          </div>
          
          <div className="p-8 pt-6 space-y-4">
            <p className="text-slate-600 text-lg">
              Система определила в накладной маркеры <strong className="text-indigo-600">[{mismatchData.detected}]</strong>.
              <br />
              Вы выбрали направление: <strong className="text-slate-900">[{mismatchData.selected}]</strong>.
            </p>
            <p className="text-slate-500">Как хотите продолжить?</p>
          </div>

          <div className="p-6 bg-slate-50 flex gap-4 border-t border-slate-100">
            <button 
              onClick={handleIgnore}
              className="flex-1 px-6 py-3 rounded-xl border border-slate-200 bg-white text-slate-600 font-bold hover:bg-slate-50 transition-all text-sm"
            >
              Продолжить с {mismatchData.selected}
            </button>
            <button 
              onClick={handleFix}
              className="flex-1 px-6 py-3 rounded-xl bg-amber-500 text-white font-bold hover:bg-amber-600 shadow-md transition-all text-sm"
            >
              Изменить на {mismatchData.detected}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};
