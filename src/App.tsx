import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { PrinterProvider } from "@/contexts/PrinterContext";
import { UserSessionProvider } from "@/contexts/UserSessionContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import Index from "./pages/Index";
import Install from "./pages/Install";
import NotFound from "./pages/NotFound";
import Login from "./pages/Login";
import Cadastro from "./pages/Cadastro";
import EsqueciSenha from "./pages/EsqueciSenha";
import RedefinirSenha from "./pages/RedefinirSenha";
import AcessoNegado from "./pages/AcessoNegado";
import FichasLista from "./pages/FichasLista";
import FichasAdmin from "./pages/FichasAdmin";
import FichasRelatorio from "./pages/FichasRelatorio";
import VoucherLista from "./pages/VoucherLista";
import ComandasLista from "./pages/ComandasLista";
import KdsPage from "./pages/KdsPage";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1 } },
});

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <UserSessionProvider>
        <PrinterProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route path="/cadastro" element={<Cadastro />} />
              <Route path="/esqueci-senha" element={<EsqueciSenha />} />
              <Route path="/redefinir-senha" element={<RedefinirSenha />} />
              <Route path="/acesso-negado" element={<AcessoNegado />} />
              <Route path="/" element={<ProtectedRoute><Index /></ProtectedRoute>} />
              <Route path="/vouchers" element={<VoucherLista />} />
              <Route path="/fichas" element={
                <ProtectedRoute permission="acesso_ficha_consumo">
                  <FichasLista />
                </ProtectedRoute>
              } />
              <Route path="/fichas-admin" element={
                <ProtectedRoute permission="acesso_cadastrar_produto">
                  <FichasAdmin />
                </ProtectedRoute>
              } />
              <Route path="/fichas-relatorio" element={
                <ProtectedRoute permission="acesso_cadastrar_produto">
                  <FichasRelatorio />
                </ProtectedRoute>
              } />
              <Route path="/comandas" element={
                <ProtectedRoute permission="acesso_ficha_consumo">
                  <ComandasLista />
                </ProtectedRoute>
              } />
              <Route path="/kds" element={
                <ProtectedRoute permission="acesso_kds">
                  <KdsPage />
                </ProtectedRoute>
              } />
              <Route path="/install" element={<Install />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </BrowserRouter>
        </PrinterProvider>
      </UserSessionProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
