package com.nexusai.assistant.ai.advanced;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class WebStudyEngine {

    private static final String TAG = "WebStudyEngine";
    private static final float EPSILON = 1e-8f;

    public enum StudyStatus {
        PENDING, RESEARCHING, EXTRACTING, LEARNING, COMPLETE, FAILED, PAUSED
    }

    public enum StudyPriority {
        CRITICAL(4), HIGH(3), MEDIUM(2), LOW(1);
        public final int weight;
        StudyPriority(int weight) { this.weight = weight; }
    }

    public static class StudyTask {
        private static long nextId = 1L;

        public final long id;
        public final String topic;
        public final List<String> searchQueries;
        public int depth;
        public int pagesFetched;
        public int factsExtracted;
        public final StudyPriority priority;
        public StudyStatus status;
        public final long createdAt;
        public long startedAt;
        public long completedAt;
        public long studyTimeMs;
        public final List<String> visitedUrls;
        public final List<String> discoveredUrls;
        public String lastError;

        public StudyTask(String topic, List<String> searchQueries, int depth, StudyPriority priority) {
            this.id = nextId++;
            this.topic = topic;
            this.searchQueries = new ArrayList<>(searchQueries);
            this.depth = depth;
            this.priority = priority;
            this.status = StudyStatus.PENDING;
            this.createdAt = System.currentTimeMillis();
            this.startedAt = 0L;
            this.completedAt = 0L;
            this.studyTimeMs = 0L;
            this.pagesFetched = 0;
            this.factsExtracted = 0;
            this.visitedUrls = new CopyOnWriteArrayList<>();
            this.discoveredUrls = new CopyOnWriteArrayList<>();
            this.lastError = null;
        }
    }

    public static class KnowledgeFact {
        public final String subject;
        public final String predicate;
        public final String object;
        public final float confidence;
        public final String sourceUrl;
        public final long extractedAt;
        public float relevanceScore;

        public KnowledgeFact(String subject, String predicate, String object, float confidence, String sourceUrl) {
            this.subject = subject;
            this.predicate = predicate;
            this.object = object;
            this.confidence = confidence;
            this.sourceUrl = sourceUrl;
            this.extractedAt = System.currentTimeMillis();
            this.relevanceScore = 0.0f;
        }

        @Override
        public String toString() {
            return String.format(Locale.US, "[%s] %s --%s--> %s (conf=%.2f, rel=%.2f)",
                    truncate(sourceUrl, 30), subject, predicate, object, confidence, relevanceScore);
        }
    }

    public static class StudyStatistics {
        public int totalTasks;
        public int completedTasks;
        public int failedTasks;
        public int totalPagesFetched;
        public int totalFactsExtracted;
        public long totalStudyTimeMs;
        public float averageConfidence;
        public int uniqueTopicsStudied;
        public final List<String> recentConcepts;
        public final Map<String, Float> accuracyTrend;

        public StudyStatistics() {
            this.recentConcepts = new ArrayList<>();
            this.accuracyTrend = new LinkedHashMap<>();
        }
    }

    private static final String PREFS_NAME = "nexusai_web_study";
    private static final String PREF_HISTORY = "study_history";
    private static final String PREF_VISITED = "visited_urls";

    private static final int DEFAULT_TIMEOUT_MS = 10_000;
    private static final int DEFAULT_DEPTH = 10;
    private static final int DEFAULT_RATE_LIMIT_MS = 2_000;
    private static final int MAX_CACHE_SIZE = 256;
    private static final int TOP_N_SENTENCES = 15;
    private static final int MAX_DISCOVERED_URLS = 200;

    private static final String USER_AGENT = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";

    private static final Pattern SCRIPT_PATTERN = Pattern.compile("<script[^>]*>.*?</script>", Pattern.CASE_INSENSITIVE | Pattern.DOTALL);
    private static final Pattern STYLE_PATTERN = Pattern.compile("<style[^>]*>.*?</style>", Pattern.CASE_INSENSITIVE | Pattern.DOTALL);
    private static final Pattern NAV_PATTERN = Pattern.compile("<nav[^>]*>.*?</nav>", Pattern.CASE_INSENSITIVE | Pattern.DOTALL);
    private static final Pattern FOOTER_PATTERN = Pattern.compile("<footer[^>]*>.*?</footer>", Pattern.CASE_INSENSITIVE | Pattern.DOTALL);
    private static final Pattern TAG_PATTERN = Pattern.compile("<[^>]+>");
    private static final Pattern ENTITY_PATTERN = Pattern.compile("&[a-zA-Z]{2,6};|&#\\d+;");
    private static final Pattern URL_PATTERN = Pattern.compile("https?://[\\w\\-._~:/?#\\[\\]@!$&'()*+,;=%]+");

    private static final String GOOGLE_SEARCH = "https://www.google.com/search?q=%s&num=10";
    private static final String WIKIPEDIA_API = "https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=%s&format=json&srlimit=10";
    private static final String DUCKDUCK_GO = "https://duckduckgo.com/html/?q=%s";

    private final Context context;
    private final AdvancedLearningEngine learningEngine;
    private final SharedPreferences preferences;

    private volatile boolean isRunning = false;
    private volatile boolean isPaused = false;
    private final Object studyLock = new Object();

    private final Map<Long, StudyTask> tasks;
    private final List<Long> taskOrder;         

    private final List<KnowledgeFact> knowledgeFacts;
    private final List<String> recentConcepts;

    private final LinkedHashMap<String, String> urlCache;
    private final Set<String> contentHashes;    
    private final Set<String> globalVisitedUrls;

    private long totalStudyTimeMs;
    private int totalPagesFetched;
    private int totalFactsExtracted;
    private final Map<String, Float> accuracyTrend;

    private int timeoutMs = DEFAULT_TIMEOUT_MS;
    private int rateLimitMs = DEFAULT_RATE_LIMIT_MS;

    private ExecutorService executorService;
    private Thread studyThread;
    private StudyProgressCallback progressCallback;

    public interface StudyProgressCallback {
        void onTaskStarted(StudyTask task);
        void onPageFetched(StudyTask task, String url, int pagesRemaining);
        void onKnowledgeExtracted(StudyTask task, KnowledgeFact fact);
        void onTaskCompleted(StudyTask task, int factsLearned);
        void onTaskFailed(StudyTask task, String error);
        void onStatisticsUpdated(StudyStatistics stats);
    }

    public WebStudyEngine(Context context, AdvancedLearningEngine learningEngine) {
        this.context = context.getApplicationContext();
        this.learningEngine = learningEngine;
        this.preferences = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);

        this.tasks = new ConcurrentHashMap<>();
        this.taskOrder = new CopyOnWriteArrayList<>();
        this.knowledgeFacts = new CopyOnWriteArrayList<>();
        this.recentConcepts = new CopyOnWriteArrayList<>();

        this.urlCache = new LinkedHashMap<String, String>(16, 0.75f, true) {
            @Override
            protected boolean removeEldestEntry(Map.Entry<String, String> eldest) {
                return size() > MAX_CACHE_SIZE;
            }
        };

        this.contentHashes = ConcurrentHashMap.newKeySet();
        this.globalVisitedUrls = ConcurrentHashMap.newKeySet();
        this.totalStudyTimeMs = 0L;
        this.totalPagesFetched = 0;
        this.totalFactsExtracted = 0;
        this.accuracyTrend = new ConcurrentHashMap<>();

        restoreVisitedUrls();

        this.executorService = Executors.newFixedThreadPool(
                Runtime.getRuntime().availableProcessors(),
                new ThreadFactory() {
                    private int count = 0;
                    @Override
                    public Thread newThread(Runnable r) {
                        Thread t = new Thread(r, "WSE-Worker-" + (count++));
                        t.setPriority(Thread.NORM_PRIORITY - 1);
                        t.setDaemon(true);
                        return t;
                    }
                });

        Log.i(TAG, "WebStudyEngine v1.0 initialized — ready for continuous web study");
    }

    public long addStudyTask(String topic, List<String> searchQueries, int depth, StudyPriority priority) {
        if (topic == null || topic.trim().isEmpty()) {
            return -1L;
        }
        if (searchQueries == null || searchQueries.isEmpty()) {
            searchQueries = Collections.singletonList(topic);
        }
        if (depth <= 0) depth = DEFAULT_DEPTH;

        StudyTask task = new StudyTask(topic.trim(), searchQueries, depth, priority);
        tasks.put(task.id, task);
        insertTaskByPriority(task.id);
        persistTaskHistory();
        return task.id;
    }

    public long addStudyTask(String topic) {
        return addStudyTask(topic, Collections.singletonList(topic), DEFAULT_DEPTH, StudyPriority.MEDIUM);
    }

    public boolean removeStudyTask(long taskId) {
        StudyTask task = tasks.remove(taskId);
        if (task != null) {
            taskOrder.remove(Long.valueOf(taskId));
            if (task.status == StudyStatus.RESEARCHING || task.status == StudyStatus.EXTRACTING || task.status == StudyStatus.LEARNING) {
                task.status = StudyStatus.FAILED;
                task.lastError = "Removed by user";
            }
            persistTaskHistory();
            return true;
        }
        return false;
    }

    public boolean pauseStudyTask(long taskId) {
        StudyTask task = tasks.get(taskId);
        if (task != null && task.status != StudyStatus.COMPLETE && task.status != StudyStatus.FAILED) {
            task.status = StudyStatus.PAUSED;
            return true;
        }
        return false;
    }

    public boolean resumeStudyTask(long taskId) {
        StudyTask task = tasks.get(taskId);
        if (task != null && task.status == StudyStatus.PAUSED) {
            task.status = StudyStatus.PENDING;
            insertTaskByPriority(taskId);
            return true;
        }
        return false;
    }

    public StudyTask getStudyTask(long taskId) {
        return tasks.get(taskId);
    }

    public List<StudyTask> getAllTasks() {
        List<StudyTask> result = new ArrayList<>();
        for (Long id : taskOrder) {
            StudyTask task = tasks.get(id);
            if (task != null) result.add(task);
        }
        return result;
    }

    public List<StudyTask> getTasksByStatus(StudyStatus status) {
        List<StudyTask> result = new ArrayList<>();
        for (StudyTask task : tasks.values()) {
            if (task.status == status) result.add(task);
        }
        return result;
    }

    public void startStudying() {
        synchronized (studyLock) {
            if (isRunning) return;
            isRunning = true;
            isPaused = false;
        }
        studyThread = new Thread(this::studyLoop, "WSE-StudyLoop");
        studyThread.setDaemon(true);
        studyThread.start();
    }

    public void pauseStudying() {
        isPaused = true;
    }

    public void resumeStudying() {
        isPaused = false;
        synchronized (studyLock) {
            studyLock.notifyAll();
        }
    }

    public void stopStudying() {
        synchronized (studyLock) {
            isRunning = false;
            isPaused = false;
            studyLock.notifyAll();
        }
    }

    public boolean isStudying() {
        return isRunning && !isPaused;
    }

    public void shutdown() {
        stopStudying();
        if (executorService != null) {
            executorService.shutdownNow();
        }
        if (studyThread != null) {
            studyThread.interrupt();
        }
        persistTaskHistory();
        persistVisitedUrls();
    }

    public void setProgressCallback(StudyProgressCallback callback) {
        this.progressCallback = callback;
    }

    public void setRateLimit(int ms) {
        this.rateLimitMs = Math.max(500, ms);
    }

    public void setTimeout(int ms) {
        this.timeoutMs = Math.max(1000, ms);
    }

    public StudyStatistics getStudyStatistics() {
        StudyStatistics stats = new StudyStatistics();
        stats.totalTasks = tasks.size();
        stats.totalPagesFetched = totalPagesFetched;
        stats.totalFactsExtracted = totalFactsExtracted;
        stats.totalStudyTimeMs = totalStudyTimeMs;

        int completed = 0, failed = 0;
        Set<String> topics = new HashSet<>();
        float confidenceSum = 0.0f;
        int confidenceCount = 0;

        for (StudyTask task : tasks.values()) {
            topics.add(task.topic.toLowerCase());
            if (task.status == StudyStatus.COMPLETE) completed++;
            if (task.status == StudyStatus.FAILED) failed++;
        }

        stats.completedTasks = completed;
        stats.failedTasks = failed;
        stats.uniqueTopicsStudied = topics.size();

        for (KnowledgeFact fact : knowledgeFacts) {
            confidenceSum += fact.confidence;
            confidenceCount++;
        }
        stats.averageConfidence = confidenceCount > 0 ? confidenceSum / confidenceCount : 0.0f;

        int start = Math.max(0, recentConcepts.size() - 20);
        stats.recentConcepts.addAll(recentConcepts.subList(start, recentConcepts.size()));
        stats.accuracyTrend.putAll(accuracyTrend);

        return stats;
    }

    public String getStatusReport() {
        StudyStatistics stats = getStudyStatistics();
        StringBuilder sb = new StringBuilder();
        sb.append("═══ WebStudyEngine Status ═══\n");
        sb.append(String.format("Running: %b | Paused: %b\n", isRunning, isPaused));
        sb.append(String.format("Tasks: %d total, %d complete, %d failed\n",
                stats.totalTasks, stats.completedTasks, stats.failedTasks));
        sb.append(String.format("Pages fetched: %d | Facts extracted: %d\n",
                stats.totalPagesFetched, stats.totalFactsExtracted));
        sb.append(String.format("Study time: %s\n", formatDuration(stats.totalStudyTimeMs)));
        sb.append(String.format("Avg confidence: %.2f\n", stats.averageConfidence));
        sb.append("────────────────────────────\n");

        for (StudyTask task : getAllTasks()) {
            sb.append(String.format("  [%s] #%d \"%s\" — %s (%d/%d pages, %d facts)\n",
                    task.priority, task.id, truncate(task.topic, 25), task.status,
                    task.pagesFetched, task.depth, task.factsExtracted));
        }

        return sb.toString();
    }

    public List<KnowledgeFact> getKnowledgeFacts() {
        return new ArrayList<>(knowledgeFacts);
    }

    public List<KnowledgeFact> getFactsForTopic(String topic) {
        List<KnowledgeFact> result = new ArrayList<>();
        String topicLower = topic.toLowerCase();
        for (KnowledgeFact fact : knowledgeFacts) {
            if (fact.subject.toLowerCase().contains(topicLower) || fact.object.toLowerCase().contains(topicLower)) {
                result.add(fact);
            }
        }
        return result;
    }

    public String fetchWebPage(String urlString) {
        if (urlString == null || urlString.trim().isEmpty()) return null;

        synchronized (urlCache) {
            if (urlCache.containsKey(urlString)) return urlCache.get(urlString);
        }

        HttpURLConnection connection = null;
        InputStream inputStream = null;
        String result = null;

        try {
            URL url = new URL(urlString);
            connection = (HttpURLConnection) url.openConnection();
            connection.setRequestMethod("GET");
            connection.setConnectTimeout(timeoutMs);
            connection.setReadTimeout(timeoutMs);
            connection.setRequestProperty("User-Agent", USER_AGENT);
            connection.setRequestProperty("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8");
            connection.setRequestProperty("Accept-Language", "en-US,en;q=0.9");
            connection.setRequestProperty("Accept-Encoding", "identity");
            connection.setInstanceFollowRedirects(true);

            int responseCode = connection.getResponseCode();
            int redirects = 0;
            while (responseCode == HttpURLConnection.HTTP_MOVED_PERM || responseCode == HttpURLConnection.HTTP_MOVED_TEMP || responseCode == HttpURLConnection.HTTP_SEE_OTHER) {
                if (redirects >= 5) return null;
                String newUrl = connection.getHeaderField("Location");
                if (newUrl == null) return null;
                if (newUrl.startsWith("/")) newUrl = url.getProtocol() + "://" + url.getHost() + newUrl;

                connection.disconnect();
                url = new URL(newUrl);
                connection = (HttpURLConnection) url.openConnection();
                connection.setRequestMethod("GET");
                connection.setConnectTimeout(timeoutMs);
                connection.setReadTimeout(timeoutMs);
                connection.setRequestProperty("User-Agent", USER_AGENT);
                connection.setRequestProperty("Accept", "text/html");
                connection.setInstanceFollowRedirects(true);
                responseCode = connection.getResponseCode();
                redirects++;
            }

            if (responseCode != HttpURLConnection.HTTP_OK) return null;

            inputStream = connection.getInputStream();
            StringBuilder content = new StringBuilder();
            BufferedReader reader = new BufferedReader(new InputStreamReader(inputStream, StandardCharsets.UTF_8));
            String line;
            while ((line = reader.readLine()) != null) content.append(line).append("\n");

            result = content.toString();

            synchronized (urlCache) {
                urlCache.put(urlString, result);
            }
            return result;
        } catch (Exception e) {
            return null;
        } finally {
            if (inputStream != null) {
                try { inputStream.close(); } catch (Exception ignored) { }
            }
            if (connection != null) connection.disconnect();
        }
    }

    public String extractTextContent(String html) {
        if (html == null || html.isEmpty()) return "";
        String text = SCRIPT_PATTERN.matcher(html).replaceAll(" ");
        text = STYLE_PATTERN.matcher(text).replaceAll(" ");
        text = NAV_PATTERN.matcher(text).replaceAll(" ");
        text = FOOTER_PATTERN.matcher(text).replaceAll(" ");
        text = text.replaceAll("<!--[\\s\\S]*?-->", " ");
        text = TAG_PATTERN.matcher(text).replaceAll(" ");
        text = text.replace("&nbsp;", " ");
        text = text.replace("&amp;", "&");
        text = text.replace("&lt;", "<");
        text = text.replace("&gt;", ">");
        text = text.replace("&quot;", "\"");
        text = text.replace("&#39;", "'");
        text = ENTITY_PATTERN.matcher(text).replaceAll(" ");
        text = text.replaceAll("[ \\t]+", " ");
        text = text.replaceAll("\\n\\s*\\n", "\n");
        return text.trim();
    }

    public List<String> splitIntoSentences(String text) {
        if (text == null || text.isEmpty()) return new ArrayList<>();
        String safe = text.replaceAll("(?i)\\bMr\\.\\s", "Mr@@ ")
                .replaceAll("(?i)\\bMrs\\.\\s", "Mrs@@ ")
                .replaceAll("(?i)\\bDr\\.\\s", "Dr@@ ")
                .replaceAll("(?i)\\bProf\\.\\s", "Prof@@ ")
                .replaceAll("(?i)\\be\\.g\\.\\s", "e.g.@@ ")
                .replaceAll("(?i)\\bi\\.e\\.\\s", "i.e.@@ ")
                .replaceAll("(?i)\\bvs\\.\\s", "vs@@ ")
                .replaceAll("(?i)\\bet al\\.\\s", "et al.@@ ");
        String[] raw = safe.split("[.!?]+\\s+");
        List<String> sentences = new ArrayList<>();
        for (String s : raw) {
            s = s.replace("@@", ".").trim();
            if (s.length() > 15 && s.length() < 500) sentences.add(s);
        }
        return sentences;
    }

    public List<String> extractParagraphs(String text) {
        if (text == null || text.isEmpty()) return new ArrayList<>();
        String[] blocks = text.split("\\n\\n+");
        List<String> paragraphs = new ArrayList<>();
        for (String block : blocks) {
            String cleaned = block.trim().replaceAll("\\s+", " ");
            if (cleaned.length() > 50 && cleaned.contains(".")) paragraphs.add(cleaned);
        }
        return paragraphs;
    }

    public List<String> generateSearchUrls(String topic) {
        List<String> urls = new ArrayList<>();
        if (topic == null || topic.trim().isEmpty()) return urls;
        try {
            String encoded = URLEncoder.encode(topic.trim(), StandardCharsets.UTF_8.name());
            urls.add(String.format(Locale.US, GOOGLE_SEARCH, encoded));
            urls.add(String.format(Locale.US, WIKIPEDIA_API, encoded));
            urls.add(String.format(Locale.US, DUCKDUCK_GO, encoded));
            String[] suffixes = {" introduction", " explained", " overview", " tutorial", " research paper", " Wikipedia"};
            for (String suffix : suffixes) {
                String variant = URLEncoder.encode(topic.trim() + suffix, StandardCharsets.UTF_8.name());
                urls.add(String.format(Locale.US, GOOGLE_SEARCH, variant));
            }
        } catch (Exception e) {}
        return urls;
    }

    public List<String> discoverUrlsFromHtml(String html, Collection<String> exclude) {
        List<String> discovered = new ArrayList<>();
        if (html == null) return discovered;
        Matcher matcher = URL_PATTERN.matcher(html);
        Set<String> seen = new HashSet<>();
        while (matcher.find()) {
            String url = matcher.group().trim();
            if (url.contains("/login") || url.contains("/signup") || url.contains("javascript:") || url.contains("mailto:") || url.contains(".css") || url.contains(".js") || url.contains(".png") || url.contains(".jpg") || url.contains(".gif") || url.contains(".svg") || url.contains(".ico") || url.endsWith("/")) continue;
            String cleanUrl = url.split("[?#]")[0];
            if (!seen.contains(cleanUrl) && !exclude.contains(cleanUrl) && !globalVisitedUrls.contains(cleanUrl)) {
                seen.add(cleanUrl);
                discovered.add(cleanUrl);
            }
            if (discovered.size() >= MAX_DISCOVERED_URLS) break;
        }
        return discovered;
    }

    public List<String> extractTopSentences(String text, String topic, int topN) {
        List<String> sentences = splitIntoSentences(text);
        if (sentences.isEmpty()) return sentences;
        Set<String> topicKeywords = new HashSet<>();
        for (String word : topic.toLowerCase().split("\\s+")) if (word.length() > 2) topicKeywords.add(word);
        Map<String, Integer> docFreq = new HashMap<>();
        for (String sentence : sentences) {
            Set<String> uniqueWords = new HashSet<>();
            for (String word : sentence.toLowerCase().split("\\s+")) if (word.length() > 2) uniqueWords.add(word);
            for (String w : uniqueWords) docFreq.merge(w, 1, Integer::sum);
        }
        int totalDocs = sentences.size();
        List<ScoredSentence> scored = new ArrayList<>();
        for (String sentence : sentences) {
            String[] words = sentence.toLowerCase().split("\\s+");
            float score = 0.0f;
            int matchedKeywords = 0;
            Set<String> seenWords = new HashSet<>();
            for (String word : words) {
                if (word.length() <= 2) continue;
                seenWords.add(word);
                if (topicKeywords.contains(word)) {
                    score += 3.0f;
                    matchedKeywords++;
                }
                float tf = 1.0f;
                int df = docFreq.getOrDefault(word, 1);
                float idf = (float) Math.log((float) totalDocs / (float) df + EPSILON);
                score += tf * idf;
            }
            int idx = sentences.indexOf(sentence);
            float positionBonus = 1.0f - (float) idx / (float) Math.max(1, sentences.size());
            score += positionBonus * 0.5f;
            int len = sentence.length();
            if (len > 40 && len < 300) score += 0.3f;
            if (!topicKeywords.isEmpty()) score += (float) matchedKeywords / (float) topicKeywords.size() * 2.0f;
            scored.add(new ScoredSentence(sentence, score));
        }
        scored.sort((a, b) -> Float.compare(b.score, a.score));
        List<String> result = new ArrayList<>();
        int count = Math.min(topN, scored.size());
        for (int i = 0; i < count; i++) result.add(scored.get(i).sentence);
        return result;
    }

    public List<KnowledgeFact> extractKnowledgeFacts(String text, String topic, float baseConfidence, String sourceUrl) {
        List<KnowledgeFact> facts = new ArrayList<>();
        if (text == null || text.isEmpty()) return facts;
        List<String> sentences = extractTopSentences(text, topic, TOP_N_SENTENCES);
        Pattern isPattern = Pattern.compile("(?i)([A-Z][\\w\\s]{2,25}?)\\s+(is|are|was|were)\\s+(.+?)\\.?$");
        Pattern hasPattern = Pattern.compile("(?i)([A-Z][\\w\\s]{2,25}?)\\s+(has|have|had|contains?)\\s+(.+?)\\.?$");
        Pattern canPattern = Pattern.compile("(?i)([A-Z][\\w\\s]{2,25}?)\\s+(can|could|may|might|will)\\s+(.+?)\\.?$");
        Pattern causedPattern = Pattern.compile("(?i)([A-Z][\\w\\s]{2,25}?)\\s+(caused|leads? to|results? in|produces?)\\s+(.+?)\\.?$");
        Object[][] allPatterns = {
                {isPattern, new String[]{"is_a", "is_a", "is_a", "is_a"}},
                {hasPattern, new String[]{"has_property", "has_property", "has_property", "has_property"}},
                {canPattern, new String[]{"can_do", "can_do", "can_do", "can_do"}},
                {causedPattern, new String[]{"caused_by", "caused_by", "caused_by", "caused_by"}}
        };
        for (String sentence : sentences) {
            String trimmed = sentence.trim();
            for (Object[] patternEntry : allPatterns) {
                Pattern pattern = (Pattern) patternEntry[0];
                String[] predicates = (String[]) patternEntry[1];
                Matcher matcher = pattern.matcher(trimmed);
                if (matcher.find()) {
                    String subject = matcher.group(1).trim();
                    String verb = matcher.group(2).trim().toLowerCase();
                    String object = matcher.group(3).trim();
                    String predicate;
                    int verbIdx = 0;
                    if (verb.equals("are") || verb.equals("were")) verbIdx = 1;
                    else if (verb.equals("was")) verbIdx = 2;
                    else if (verb.equals("have") || verb.equals("had")) verbIdx = 2;
                    else if (verb.equals("could") || verb.equals("might")) verbIdx = 1;
                    predicate = predicates[verbIdx];
                    if (object.length() > 100) object = object.substring(0, 97) + "...";
                    String contentHash = computeContentHash(subject + predicate + object);
                    if (contentHashes.contains(contentHash)) continue;
                    float confidence = baseConfidence;
                    if (sourceUrl != null && sourceUrl.contains("wikipedia.org")) confidence = Math.min(1.0f, confidence + 0.15f);
                    if (trimmed.matches(".*\\d+.*")) confidence = Math.min(1.0f, confidence + 0.05f);
                    KnowledgeFact fact = new KnowledgeFact(subject, predicate, object, confidence, sourceUrl);
                    facts.add(fact);
                    contentHashes.add(contentHash);
                    break;
                }
            }
        }
        return facts;
    }

    private void studyLoop() {
        while (isRunning) {
            try {
                if (isPaused) {
                    synchronized (studyLock) {
                        while (isPaused && isRunning) studyLock.wait(1000);
                    }
                    if (!isRunning) break;
                    continue;
                }
                StudyTask task = findNextPendingTask();
                if (task == null) {
                    Thread.sleep(5000);
                    continue;
                }
                processStudyTask(task);
                Thread.sleep(rateLimitMs);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                break;
            } catch (Exception e) {
                try { Thread.sleep(5000); } catch (InterruptedException ignored) { }
            }
        }
    }

    private void processStudyTask(StudyTask task) {
        long taskStartMs = System.currentTimeMillis();
        try {
            task.status = StudyStatus.RESEARCHING;
            if (task.startedAt == 0) task.startedAt = taskStartMs;
            notifyTaskStarted(task);
            List<String> searchUrls = new ArrayList<>();
            for (String query : task.searchQueries) searchUrls.addAll(generateSearchUrls(query));
            for (String searchUrl : searchUrls) {
                if (!isRunning || task.status == StudyStatus.PAUSED) break;
                if (task.discoveredUrls.size() >= task.depth * 3) break;
                String html = fetchWebPage(searchUrl);
                if (html != null) {
                    List<String> discovered = discoverUrlsFromHtml(html, task.visitedUrls);
                    task.discoveredUrls.addAll(discovered);
                }
                Thread.sleep(rateLimitMs);
            }
            if (task.discoveredUrls.isEmpty()) task.discoveredUrls.addAll(searchUrls);
            int processed = 0;
            for (String contentUrl : task.discoveredUrls) {
                if (!isRunning || task.status == StudyStatus.PAUSED) break;
                if (task.pagesFetched >= task.depth) break;
                if (globalVisitedUrls.contains(contentUrl)) continue;
                task.status = StudyStatus.EXTRACTING;
                String html = fetchWebPage(contentUrl);
                if (html == null) {
                    task.visitedUrls.add(contentUrl);
                    globalVisitedUrls.add(contentUrl);
                    Thread.sleep(rateLimitMs / 2);
                    continue;
                }
                String textContent = extractTextContent(html);
                task.visitedUrls.add(contentUrl);
                globalVisitedUrls.add(contentUrl);
                task.pagesFetched++;
                totalPagesFetched++;
                List<String> newUrls = discoverUrlsFromHtml(html, task.visitedUrls);
                task.discoveredUrls.addAll(newUrls);
                task.status = StudyStatus.LEARNING;
                List<KnowledgeFact> facts = extractKnowledgeFacts(textContent, task.topic, 0.6f, contentUrl);
                for (KnowledgeFact fact : facts) {
                    feedFactToLearningEngine(task, fact);
                    task.factsExtracted++;
                    totalFactsExtracted++;
                    knowledgeFacts.add(fact);
                    notifyKnowledgeExtracted(task, fact);
                }
                List<String> topSentences = extractTopSentences(textContent, task.topic, 5);
                for (String sentence : topSentences) {
                    String contentHash = computeContentHash(sentence);
                    if (!contentHashes.contains(contentHash)) {
                        contentHashes.add(contentHash);
                        learningEngine.addLearningExample(sentence, "relevant to: " + task.topic, AdvancedLearningEngine.LearningType.SUPERVISED);
                        task.factsExtracted++;
                        totalFactsExtracted++;
                        addRecentConcept(sentence);
                    }
                }
                if (!facts.isEmpty()) {
                    float avgConf = 0.0f;
                    for (KnowledgeFact f : facts) avgConf += f.confidence;
                    avgConf /= facts.size();
                    accuracyTrend.put(task.topic.toLowerCase(), avgConf);
                }
                processed++;
                notifyPageFetched(task, contentUrl, task.depth - task.pagesFetched);
                Thread.sleep(rateLimitMs);
            }
            task.status = StudyStatus.COMPLETE;
            task.completedAt = System.currentTimeMillis();
            task.studyTimeMs = task.completedAt - task.startedAt;
            totalStudyTimeMs += task.studyTimeMs;
            notifyTaskCompleted(task, task.factsExtracted);
            persistVisitedUrls();
            persistTaskHistory();
        } catch (Exception e) {
            task.status = StudyStatus.FAILED;
            task.lastError = e.getMessage();
            notifyTaskFailed(task, e.getMessage());
        }
    }

    private void feedFactToLearningEngine(StudyTask task, KnowledgeFact fact) {
        String input = "What " + fact.predicate.replace("_", " ") + " " + fact.subject + "?";
        String expectedOutput = fact.subject + " " + fact.predicate.replace("_", " ") + " " + fact.object;
        learningEngine.addLearningExample(input, expectedOutput, AdvancedLearningEngine.LearningType.SUPERVISED);
        String rawFact = fact.subject + " " + fact.predicate.replace("_", " ") + " " + fact.object;
        learningEngine.addLearningExample(rawFact, "", AdvancedLearningEngine.LearningType.UNSUPERVISED);
        addRecentConcept(rawFact);
    }

    private StudyTask findNextPendingTask() {
        synchronized (taskOrder) {
            for (Long taskId : taskOrder) {
                StudyTask task = tasks.get(taskId);
                if (task != null && task.status == StudyStatus.PENDING) return task;
            }
        }
        return null;
    }

    public void clearCache() {
        synchronized (urlCache) { urlCache.clear(); }
        contentHashes.clear();
    }

    public int getCacheSize() {
        synchronized (urlCache) { return urlCache.size(); }
    }

    public int getContentHashCount() {
        return contentHashes.size();
    }

    private String computeContentHash(String content) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(content.toLowerCase().trim().getBytes(StandardCharsets.UTF_8));
            StringBuilder hex = new StringBuilder();
            for (byte b : hash) hex.append(String.format(Locale.US, "%02x", b));
            return hex.toString();
        } catch (Exception e) {
            return String.valueOf(content.toLowerCase().trim().hashCode());
        }
    }

    private void persistTaskHistory() {
        try {
            StringBuilder sb = new StringBuilder();
            for (StudyTask task : tasks.values()) sb.append(task.id).append("|").append(escape(task.topic)).append("|").append(task.priority.weight).append("|").append(task.depth).append("|").append(task.pagesFetched).append("|").append(task.factsExtracted).append("|").append(task.status.name()).append("|").append(task.studyTimeMs).append(";");
            preferences.edit().putString(PREF_HISTORY, sb.toString()).apply();
        } catch (Exception e) {}
    }

    private void restoreVisitedUrls() {
        try {
            String stored = preferences.getString(PREF_VISITED, "");
            if (!stored.isEmpty()) {
                String[] urls = stored.split(";");
                for (String url : urls) {
                    String trimmed = url.trim();
                    if (!trimmed.isEmpty()) globalVisitedUrls.add(trimmed);
                }
            }
        } catch (Exception e) {}
    }

    private void persistVisitedUrls() {
        try {
            StringBuilder sb = new StringBuilder();
            int count = 0;
            for (String url : globalVisitedUrls) {
                if (count >= 1000) break;
                sb.append(url).append(";");
                count++;
            }
            preferences.edit().putString(PREF_VISITED, sb.toString()).apply();
        } catch (Exception e) {}
    }

    private void notifyTaskStarted(StudyTask task) {
        if (progressCallback != null) { try { progressCallback.onTaskStarted(task); } catch (Exception ignored) { } }
    }

    private void notifyPageFetched(StudyTask task, String url, int remaining) {
        if (progressCallback != null) { try { progressCallback.onPageFetched(task, url, remaining); } catch (Exception ignored) { } }
    }

    private void notifyKnowledgeExtracted(StudyTask task, KnowledgeFact fact) {
        if (progressCallback != null) { try { progressCallback.onKnowledgeExtracted(task, fact); } catch (Exception ignored) { } }
    }

    private void notifyTaskCompleted(StudyTask task, int factsLearned) {
        if (progressCallback != null) { try { progressCallback.onTaskCompleted(task, factsLearned); } catch (Exception ignored) { } }
    }

    private void notifyTaskFailed(StudyTask task, String error) {
        if (progressCallback != null) { try { progressCallback.onTaskFailed(task, error); } catch (Exception ignored) { } }
    }

    private void insertTaskByPriority(long taskId) {
        synchronized (taskOrder) {
            StudyTask task = tasks.get(taskId);
            if (task == null) return;
            if (taskOrder.contains(taskId)) taskOrder.remove(taskId);
            int insertPos = taskOrder.size();
            for (int i = 0; i < taskOrder.size(); i++) {
                StudyTask existing = tasks.get(taskOrder.get(i));
                if (existing != null && existing.priority.weight < task.priority.weight) {
                    insertPos = i;
                    break;
                }
            }
            taskOrder.add(insertPos, taskId);
        }
    }

    private void addRecentConcept(String concept) {
        if (concept == null || concept.trim().isEmpty()) return;
        String trimmed = concept.trim();
        if (trimmed.length() > 80) trimmed = trimmed.substring(0, 77) + "...";
        recentConcepts.add(trimmed);
        while (recentConcepts.size() > 100) recentConcepts.remove(0);
    }

    private String escape(String input) {
        if (input == null) return "";
        return input.replace("|", "\\|");
    }

    private static String truncate(String input, int maxLen) {
        if (input == null) return "null";
        if (input.length() <= maxLen) return input;
        return input.substring(0, maxLen - 3) + "...";
    }

    private static String formatDuration(long ms) {
        long totalSeconds = ms / 1000;
        long hours = totalSeconds / 3600;
        long minutes = (totalSeconds % 3600) / 60;
        long seconds = totalSeconds % 60;
        return String.format(Locale.US, "%02d:%02d:%02d", hours, minutes, seconds);
    }

    private static class ScoredSentence {
        final String sentence;
        final float score;
        ScoredSentence(String sentence, float score) {
            this.sentence = sentence;
            this.score = score;
        }
    }
}
